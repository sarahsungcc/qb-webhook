// ============================================================
// QuickBase Webhook Server
// Generates Simplifile CSV and RevSprings Companion File
// and emails them to servicing@certaincapital.com
// ============================================================

const express = require('express');
const fetch   = require('node-fetch');
const sgMail  = require('@sendgrid/mail');

const app = express();
app.use(express.json());

// ============================================================
// CONFIGURATION — set these in your Render environment variables
// ============================================================
const QB_REALM        = process.env.QB_REALM        || 'certaincapitaladvisors.quickbase.com';
const QB_USER_TOKEN   = process.env.QB_USER_TOKEN;
const QB_PARENT_TABLE = process.env.QB_PARENT_TABLE  || 'buiuyx96s';
const QB_DIST_TABLE   = process.env.QB_DIST_TABLE    || 'buiuypuxi';
const SENDGRID_KEY    = process.env.SENDGRID_KEY;
const TO_EMAIL        = 'servicing@certaincapital.com';
const FROM_EMAIL      = process.env.FROM_EMAIL || 'noreply@certaincapital.com';

// ============================================================
// DISTRICT LOOKUP TABLE
// To add a new district: copy an existing entry and update.
// sewerPayee: used when charge type is Sewer
// waterPayee: used when charge type is Water
// Address is always the same regardless of charge type.
// ============================================================
const DISTRICT_LOOKUP = {
  'Atlantic City': {
    payeeGroup: 1,
    payee: 'City of Atlantic City',
    addr1: '1301 Bacharach Blvd',
    addr2: 'Suite 126',
    addr3: 'Atlantic City',
    addr4: 'NJ',
    addr5: '08401'
  },
  'Camden City': {
    payeeGroup: 2,
    payee: 'The City of Camden',
    addr1: '520 Market Street',
    addr2: '',
    addr3: 'Camden',
    addr4: 'NJ',
    addr5: '08101'
  },
  'Egg Harbor Township': {
    payeeGroup: 3,
    payee: 'Egg Harbor Township Tax Collector',
    sewerPayee: 'Egg Harbor Township MUA',
    addr1: '3515 Bargaintown Road',
    addr2: '',
    addr3: 'Egg Harbor Township',
    addr4: 'NJ',
    addr5: '08234'
  },
  'Ewing Township': {
    payeeGroup: 4,
    payee: 'Ewing Township Tax Office',
    addr1: '2 Jake Garzio Drive',
    addr2: '',
    addr3: 'Ewing',
    addr4: 'NJ',
    addr5: '08628'
  },
  'Galloway Township': {
    payeeGroup: 5,
    payee: 'Galloway Township',
    addr1: '300 East Jimmie Leeds Road',
    addr2: '',
    addr3: 'Galloway',
    addr4: 'NJ',
    addr5: '08205'
  },
  'Gloucester Township': {
    payeeGroup: 6,
    payee: 'Township of Gloucester',
    addr1: '1261 Chews Landing Road',
    addr2: '',
    addr3: 'Laurel Springs',
    addr4: 'NJ',
    addr5: '08021'
  },
  'Lacey Township': {
    payeeGroup: 7,
    payee: 'Township of Lacey',
    sewerPayee: 'LMUA',
    waterPayee: 'LMUA',
    electricPayee: 'LMUA',
    utilityPayee: 'LMUA',
    addr1: '818 Lacey Road',
    addr2: '',
    addr3: 'Forked River',
    addr4: 'NJ',
    addr5: '08731'
  },
  'Pleasantville City': {
    payeeGroup: 8,
    payee: 'City Of Pleasantville',
    addr1: '18 N First St',
    addr2: '',
    addr3: 'Pleasantville',
    addr4: 'NJ',
    addr5: '08232'
  },
  'Seaside Heights Borough': {
    payeeGroup: 9,
    payee: 'Borough of Seaside Heights',
    addr1: '100 Grant Avenue',
    addr2: 'Building B',
    addr3: 'Seaside Heights',
    addr4: 'NJ',
    addr5: '08751'
  },
  'Teaneck Township': {
    payeeGroup: 10,
    payee: 'Teaneck Township',
    addr1: '318 Teaneck Road',
    addr2: '',
    addr3: 'Teaneck',
    addr4: 'NJ',
    addr5: '07666'
  }
};

// ============================================================
// CHARGE TYPE CONFIG
// ============================================================
const CHARGE_TYPES = [
  { id: 76,  suffix: 'P', label: 'Property' },
  { id: 77,  suffix: 'W', label: 'Water'    },
  { id: 78,  suffix: 'S', label: 'Sewer'    },
  { id: 132, suffix: 'E', label: 'Electric' },
  { id: 79,  suffix: 'U', label: 'Utility'  }
];

// ============================================================
// FIELD ID MAP
// ============================================================
const F = {
  LIEN_NUM:     42,
  BLOCK:        23,
  LOT:          24,
  QUAL:         25,
  COUNTY:       84,
  MUNICIPALITY:  9,
  STATE:         8,
  PROP_TAX:     76,
  UTILITY_I:    77,
  UTILITY_II:   78,
  UTILITY_III: 132,
  OTHER:        79
};

// ============================================================
// HELPERS
// ============================================================
function toNum(val) {
  if (!val || val.value === null || val.value === undefined) return 0;
  return parseFloat(val.value) || 0;
}

function toStr(val) {
  if (!val || val.value === null || val.value === undefined) return '';
  return String(val.value).trim().replace(/\n/g, '');
}

function escCSV(v) {
  const s = String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

// ============================================================
// QUICKBASE API QUERY
// ============================================================
async function queryQB(tableId, select, where) {
  const response = await fetch('https://api.quickbase.com/v1/records/query', {
    method: 'POST',
    headers: {
      'QB-Realm-Hostname': QB_REALM,
      'Authorization': `QB-USER-TOKEN ${QB_USER_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: tableId,
      select,
      where,
      options: { skip: 0, top: 1000 }
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`QuickBase API error: ${response.status} — ${err}`);
  }

  const data = await response.json();
  return data.data || [];
}

// ============================================================
// BUILD FIPS MAP from Districts table
// ============================================================
async function buildFipsMap() {
  const records = await queryQB(QB_DIST_TABLE, [6, 18], '');
  const fipsMap = {};
  records.forEach(record => {
    const name = record[6]  && record[6].value  ? String(record[6].value).trim()  : '';
    const fips = record[18] && record[18].value ? String(record[18].value).trim() : '';
    if (name) fipsMap[name] = fips;
  });
  return fipsMap;
}

// ============================================================
// GENERATE SIMPLIFILE CSV
// ============================================================
function generateSimplifile(records, fipsMap) {
  const rows = [];
  rows.push('Package Name,County,Municipality,State,Certificate Number,Block,Lot,Qual,Date,Charge Amount,Charge Type,Unique ID');

  records.forEach(record => {
    const lienNum      = toStr(record[F.LIEN_NUM]);
    const block        = toStr(record[F.BLOCK]);
    const lot          = toStr(record[F.LOT]);
    const rawQual      = toStr(record[F.QUAL]);
    const qual         = rawQual.replace(/^-/, '');
    const county       = toStr(record[F.COUNTY]) ? toStr(record[F.COUNTY]) + ' County' : '';
    const municipality = toStr(record[F.MUNICIPALITY]);
    const state        = toStr(record[F.STATE]);

    const rawFips = fipsMap[municipality] || '';
    const fips    = rawFips.replace(/^1-\d{2}-/, '');

    const qualPart = qual ? '_' + qual : '';
    const baseName = `C1_${fips}_${lienNum}_${block}_${lot}${qualPart}_`;

    CHARGE_TYPES.forEach(ct => {
      const amount = toNum(record[ct.id]);
      if (amount > 0) {
        const packageName = `${baseName}${ct.suffix}`;
        const uniqueId    = `${packageName}.pdf`;
        rows.push([
          escCSV(packageName),
          escCSV(county),
          escCSV(municipality),
          escCSV(state),
          escCSV(lienNum),
          escCSV(block),
          escCSV(lot),
          escCSV(qual ? qual : '-'),
          '',
          amount.toFixed(2),
          ct.label,
          escCSV(uniqueId)
        ].join(','));
      }
    });
  });

  return rows.join('\n');
}

// ============================================================
// GENERATE REVSPRINGS COMPANION FILE CSV
// ============================================================
function generateRevSprings(records, fipsMap) {
  const rows = [];
  rows.push('Active Parcel - District,Letter Code,Charge Type,Charge Amount,Payee Group,Payee,Check #,Check Memo (Unique),File Name,Payee Address Send I,Payee Address Send II,Payee Address Send III,Payee Address Send IV,Payee Address Send V,Active Lien Number');

  records.forEach(record => {
    const lienNum      = toStr(record[F.LIEN_NUM]);
    const block        = toStr(record[F.BLOCK]);
    const lot          = toStr(record[F.LOT]);
    const rawQual      = toStr(record[F.QUAL]);
    const qual         = rawQual.replace(/^-/, '');
    const municipality = toStr(record[F.MUNICIPALITY]);

    const rawFips  = fipsMap[municipality] || '';
    const fips     = rawFips.replace(/^1-\d{2}-/, '');
    const distInfo = DISTRICT_LOOKUP[municipality];

    const qualPart = qual ? '_' + qual : '';
    const baseName = `C1_${fips}_${lienNum}_${block}_${lot}${qualPart}_`;

    CHARGE_TYPES.forEach(ct => {
      const amount = toNum(record[ct.id]);
      if (amount > 0) {
        const checkMemo = `${baseName}${ct.suffix}`;
        const fileName  = `${checkMemo}.pdf`;

        // Resolve payee based on charge type exceptions
        let payee = distInfo ? distInfo.payee : '';
        if (distInfo) {
          if (ct.label === 'Sewer' && distInfo.sewerPayee) payee = distInfo.sewerPayee;
          else if (ct.label === 'Water' && distInfo.waterPayee) payee = distInfo.waterPayee;
          else if (ct.label === 'Electric' && distInfo.electricPayee) payee = distInfo.electricPayee;
          else if (ct.label === 'Utility' && distInfo.utilityPayee) payee = distInfo.utilityPayee;
        }

        rows.push([
          escCSV(municipality),
          'C1',
          ct.label,
          amount.toFixed(2),
          distInfo ? distInfo.payeeGroup : '',
          escCSV(payee),
          '',
          escCSV(checkMemo),
          escCSV(fileName),
          escCSV(distInfo ? distInfo.addr1 : ''),
          escCSV(distInfo ? distInfo.addr2 : ''),
          escCSV(distInfo ? distInfo.addr3 : ''),
          escCSV(distInfo ? distInfo.addr4 : ''),
          escCSV(distInfo ? distInfo.addr5 : ''),
          escCSV(lienNum)
        ].join(','));
      }
    });
  });

  return rows.join('\n');
}

// ============================================================
// SEND EMAIL WITH CSV ATTACHMENTS
// ============================================================
async function sendEmail(simplifileCsv, revspringsCsv) {
  sgMail.setApiKey(SENDGRID_KEY);

  const today = new Date().toISOString().slice(0, 10);

  await sgMail.send({
    to:      TO_EMAIL,
    from:    FROM_EMAIL,
    subject: `NJ Sub Tax CSV Files — ${today}`,
    text:    `Please find attached the Simplifile CSV and RevSprings Companion File generated on ${today}.`,
    attachments: [
      {
        content:     Buffer.from(simplifileCsv).toString('base64'),
        filename:    `Simplifile_Upload_${today}.csv`,
        type:        'text/csv',
        disposition: 'attachment'
      },
      {
        content:     Buffer.from(revspringsCsv).toString('base64'),
        filename:    `RevSprings_Companion_File_${today}.csv`,
        type:        'text/csv',
        disposition: 'attachment'
      }
    ]
  });
}

// ============================================================
// WEBHOOK ENDPOINT
// POST /webhook
// Called by QuickBase Pipeline when sub tax fields are updated
// ============================================================
app.post('/webhook', async (req, res) => {
  console.log(`[${new Date().toISOString()}] Webhook received`);

  try {
    // Validate config
    if (!QB_USER_TOKEN) throw new Error('QB_USER_TOKEN environment variable not set');
    if (!SENDGRID_KEY)  throw new Error('SENDGRID_KEY environment variable not set');

    // Step 1: Build FIPS map from Districts table
    console.log('Querying Districts table...');
    const fipsMap = await buildFipsMap();
    console.log(`FIPS map built: ${Object.keys(fipsMap).length} districts`);

    // Step 2: Query Parent table — NJ records with any sub tax figure > 0
    console.log('Querying Parent table...');
    const where = `{8.EX.'New Jersey'}AND({76.GT.0}OR{77.GT.0}OR{78.GT.0}OR{132.GT.0}OR{79.GT.0})`;
    const records = await queryQB(
      QB_PARENT_TABLE,
      [F.LIEN_NUM, F.BLOCK, F.LOT, F.QUAL, F.COUNTY, F.MUNICIPALITY, F.STATE, F.PROP_TAX, F.UTILITY_I, F.UTILITY_II, F.UTILITY_III, F.OTHER],
      where
    );
    console.log(`Records returned: ${records.length}`);

    if (records.length === 0) {
      console.log('No records with sub tax figures found — skipping email');
      return res.status(200).json({ message: 'No records found, email not sent' });
    }

    // Step 3: Generate both CSVs
    console.log('Generating CSVs...');
    const simplifileCsv  = generateSimplifile(records, fipsMap);
    const revspringsCsv  = generateRevSprings(records, fipsMap);

    const simplifileRows = simplifileCsv.split('\n').length - 1;
    const revspringsRows = revspringsCsv.split('\n').length - 1;
    console.log(`Simplifile rows: ${simplifileRows}, RevSprings rows: ${revspringsRows}`);

    // Step 4: Send email with both attachments
    console.log('Sending email...');
    await sendEmail(simplifileCsv, revspringsCsv);
    console.log(`Email sent to ${TO_EMAIL}`);

    res.status(200).json({
      message:       'Success',
      simplifileRows,
      revspringsRows,
      emailSentTo:   TO_EMAIL
    });

  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// HEALTH CHECK ENDPOINT
// GET /health — confirms server is running
// ============================================================
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Webhook endpoint: POST /webhook`);
  console.log(`Health check:     GET  /health`);
});
