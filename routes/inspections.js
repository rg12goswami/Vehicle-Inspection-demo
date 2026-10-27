const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const archiver = require('archiver');
const { readData, writeData } = require('../utils/jsonStore');

const router = express.Router();
const ROOT = path.join(__dirname, '..');
const UPLOADS_DIR = path.join(ROOT, 'uploads');
const REPORTS_DIR = path.join(ROOT, 'reports');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'demo123';

const STEPS = [
  ['FRONT', 'Front View', true],
  ['REAR', 'Rear View', true],
  ['LEFT', 'Left Side', true],
  ['RIGHT', 'Right Side', true],
  ['CHASSIS_IMPRINT', 'Chassis Imprint', false],
  ['CHASSIS_NUMBER', 'Chassis Number', true],
  ['DAMAGE_1', 'Damage Photo 1', false],
  ['DAMAGE_2', 'Damage Photo 2', false],
  ['DAMAGE_3', 'Damage Photo 3', false],
  ['DAMAGE_4', 'Damage Photo 4', false],
  ['ENGINE_PLATE', 'Engine Registration Plate', false],
  ['ENGINE_IMAGE', 'Engine Image', true],
  ['ODOMETER', 'Odometer', true],
  ['INTERIOR', 'Interior / Cabin', false],
  ['SHORT_VIDEO', 'Short Walk-around Video', false]
];

const STEP_LOOKUP = Object.fromEntries(
  STEPS.map(([key, label, required]) => [
    key,
    { key, label, required }
  ])
);

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png']);
const VIDEO_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime'
]);

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(REPORTS_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 45 * 1024 * 1024,
    files: 1
  },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set([
      ...IMAGE_TYPES,
      ...VIDEO_TYPES
    ]);

    if (!allowed.has(file.mimetype)) {
      return cb(
        Object.assign(
          new Error('Use JPG/PNG photos or MP4/MOV/WebM video.'),
          { status: 400, expose: true }
        )
      );
    }

    cb(null, true);
  }
});

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }

  return res.status(401).json({
    error: 'Please sign in to the admin dashboard.'
  });
}

function findInspection(id) {
  return readData().inspections.find(i => i.id === id);
}

function updateInspection(id, updater) {
  const data = readData();

  const index = data.inspections.findIndex(
    i => i.id === id
  );

  if (index < 0) return null;

  updater(data.inspections[index]);
  writeData(data);

  return data.inspections[index];
}

function origin(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function publicView(inspection) {
  const media = (inspection.media || []).map(m => ({
    id: m.id,
    category: m.category,
    label: m.label,
    mimeType: m.mimeType,
    size: m.size,
    uploadedAt: m.uploadedAt,
    url: `/media/${inspection.uploadToken}/${m.id}`
  }));

  const keys = new Set(media.map(m => m.category));

  const missing = STEPS
    .filter(step => step[2] && !keys.has(step[0]))
    .map(step => step[0]);

  return {
    id: inspection.id,
    status: inspection.status,
    createdAt: inspection.createdAt,
    updatedAt: inspection.updatedAt,
    media,
    missing,
    category: inspection.details?.vehicleCategory || ''
  };
}

function adminView(inspection, req) {
  return {
    ...publicView(inspection),
    uploadLink: `${origin(req)}/upload/${inspection.uploadToken}`,
    details: inspection.details || {},
    report: inspection.report || null,
    reportOutOfDate: !!inspection.reportOutOfDate
  };
}

function cleanDetails(input, previous = {}) {
  const allowed = [
    'customerName',
    'customerAddress',
    'reportReference',
    'reportDate',
    'bankName',
    'inspectorName',
    'inspectionLocation',
    'registrationNumber',
    'manufacturer',
    'model',
    'manufactureYear',
    'registrationDate',
    'chassisNumber',
    'engineNumber',
    'vehicleCategory',
    'vehicleType',
    'bodyType',
    'fuelType',
    'colour',
    'odometer',
    'insuranceDetails',
    'fitnessStatus',
    'permitStatus',
    'taxStatus',
    'engineCondition',
    'transmissionCondition',
    'brakesCondition',
    'steeringCondition',
    'suspensionCondition',
    'electricalCondition',
    'batteryCondition',
    'tyreCondition',
    'bodyCondition',
    'chassisCondition',
    'interiorCondition',
    'valuationAmount',
    'invoiceCost',
    'estimatedRepairCost',
    'remainingLife',
    'overallCondition',
    'remarks',
    'disclaimer',
    'companyName',
    'companyAddress',
    'inspectorSignatureName'
  ];

  const result = { ...previous };

  for (const key of allowed) {
    if (
      Object.prototype.hasOwnProperty.call(input || {}, key)
    ) {
      result[key] = String(input[key] ?? '').slice(0, 4000);
    }
  }

  return result;
}

function safeFilename(name) {
  return path.basename(name)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 140);
}

// --------------------------------------------------
// ADMIN LOGIN
// --------------------------------------------------

router.post('/admin/login', (req, res) => {
  const password = String(req.body?.password || '');

  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({
      error: 'Incorrect password.'
    });
  }

  req.session.isAdmin = true;
  res.json({ ok: true });
});

router.post('/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('vehicle-demo.sid');
    res.json({ ok: true });
  });
});

router.get('/admin/me', (req, res) => {
  res.json({
    authenticated: !!req.session?.isAdmin
  });
});

// --------------------------------------------------
// CREATE AND LIST INSPECTIONS
// --------------------------------------------------

router.post('/admin/inspections', requireAdmin, (req, res) => {
  try {
    const data = readData();

    let id;

    do {
      id = 'INS-' + crypto.randomBytes(4)
        .toString('hex')
        .toUpperCase();
    } while (data.inspections.some(i => i.id === id));

    const inspection = {
      id,
      uploadToken: crypto.randomBytes(24).toString('hex'),
      status: 'Awaiting Upload',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      media: [],
      details: {},
      report: null,
      reportOutOfDate: true
    };

    data.inspections.push(inspection);
    writeData(data);

    res.status(201).json(adminView(inspection, req));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/admin/inspections', requireAdmin, (req, res) => {
  try {
    res.json(
      readData().inspections
        .slice()
        .reverse()
        .map(i => adminView(i, req))
    );
  } catch (_err) {
    res.status(500).json({
      error: 'Could not load local records.'
    });
  }
});

router.get(
  '/admin/inspections/:id',
  requireAdmin,
  (req, res) => {
    const inspection = findInspection(req.params.id);

    if (!inspection) {
      return res.status(404).json({
        error: 'Inspection not found.'
      });
    }

    res.json(adminView(inspection, req));
  }
);

// --------------------------------------------------
// SAVE OR EDIT VEHICLE DETAILS
// --------------------------------------------------

router.put(
  '/admin/inspections/:id/details',
  requireAdmin,
  (req, res) => {
    try {
      const updated = updateInspection(
        req.params.id,
        inspection => {
          inspection.details = cleanDetails(
            req.body || {},
            inspection.details || {}
          );

          inspection.updatedAt = new Date().toISOString();
          inspection.reportOutOfDate = true;

          if ((inspection.media || []).length) {
            inspection.status = 'Details Saved';
          }
        }
      );

      if (!updated) {
        return res.status(404).json({
          error: 'Inspection not found.'
        });
      }

      res.json(adminView(updated, req));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// --------------------------------------------------
// PUBLIC INSPECTION LINK
// --------------------------------------------------

router.get('/public/inspection/:token', (req, res) => {
  const inspection = readData().inspections.find(
    item => item.uploadToken === req.params.token
  );

  if (!inspection) {
    return res.status(404).json({
      error: 'Invalid or expired upload link.'
    });
  }

  res.json(publicView(inspection));
});

// --------------------------------------------------
// UPLOAD PHOTO OR VIDEO
// --------------------------------------------------

router.post(
  '/public/inspection/:token/media',
  (req, res, next) => {
    upload.single('file')(req, res, err => {
      if (err) {
        return res.status(err.status || 400).json({
          error: err.message || 'Upload failed.'
        });
      }

      next();
    });
  },
  (req, res) => {
    try {
      const data = readData();

      const inspection = data.inspections.find(
        item => item.uploadToken === req.params.token
      );

      if (!inspection) {
        return res.status(404).json({
          error: 'Invalid or expired upload link.'
        });
      }

      if (!req.file) {
        return res.status(400).json({
          error: 'Choose a file first.'
        });
      }

      const category = String(
        req.query.category || req.body.category || ''
      ).toUpperCase();

      const step = STEP_LOOKUP[category];

      if (!step) {
        return res.status(400).json({
          error: 'Unknown capture step.'
        });
      }

      const isVideoStep = category === 'SHORT_VIDEO';

      if (
        isVideoStep &&
        !VIDEO_TYPES.has(req.file.mimetype)
      ) {
        return res.status(400).json({
          error: 'Upload an MP4, MOV or WebM video.'
        });
      }

      if (
        !isVideoStep &&
        !IMAGE_TYPES.has(req.file.mimetype)
      ) {
        return res.status(400).json({
          error: 'Upload a JPG or PNG photo.'
        });
      }

      const folder = path.join(UPLOADS_DIR, inspection.id);

      fs.mkdirSync(folder, { recursive: true });

      const extensions = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'video/mp4': '.mp4',
        'video/webm': '.webm',
        'video/quicktime': '.mov'
      };

      const filename =
        `${category.toLowerCase()}-${Date.now()}-` +
        `${crypto.randomBytes(3).toString('hex')}` +
        `${extensions[req.file.mimetype] || ''}`;

      fs.writeFileSync(
        path.join(folder, filename),
        req.file.buffer,
        { mode: 0o600 }
      );

      const old = (inspection.media || []).find(
        m => m.category === category
      );

      const media = {
        id: crypto.randomBytes(9).toString('hex'),
        category,
        label: step.label,
        filename,
        originalName: safeFilename(req.file.originalname),
        mimeType: req.file.mimetype,
        size: req.file.size,
        uploadedAt: new Date().toISOString()
      };

      inspection.media = (inspection.media || [])
        .filter(m => m.category !== category);

      inspection.media.push(media);

      const hasRequired = STEPS
        .filter(s => s[2])
        .every(s =>
          inspection.media.some(m => m.category === s[0])
        );

      inspection.status = hasRequired
        ? 'Media Complete'
        : 'In Progress';

      inspection.updatedAt = new Date().toISOString();
      inspection.reportOutOfDate = true;

      writeData(data);

      if (old) {
        const oldPath = path.join(folder, old.filename);

        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }

      res.status(201).json({
        ok: true,
        media: {
          ...media,
          url: `/media/${inspection.uploadToken}/${media.id}`
        },
        inspection: publicView(inspection)
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// --------------------------------------------------
// ADMIN MEDIA PREVIEW
// --------------------------------------------------

router.get(
  '/admin/inspections/:id/media/:mediaId',
  requireAdmin,
  (req, res) => {
    const inspection = findInspection(req.params.id);

    if (!inspection) return res.status(404).end();

    const media = (inspection.media || []).find(
      m => m.id === req.params.mediaId
    );

    if (!media) return res.status(404).end();

    const file = path.join(
      UPLOADS_DIR,
      inspection.id,
      media.filename
    );

    if (!fs.existsSync(file)) return res.status(404).end();

    res.type(media.mimeType)
      .set(
        'Content-Disposition',
        `inline; filename="${safeFilename(media.filename)}"`
      )
      .sendFile(file);
  }
);

// --------------------------------------------------
// GENERATE PDF REPORT
// --------------------------------------------------

router.post(
  '/admin/inspections/:id/generate-pdf',
  requireAdmin,
  async (req, res) => {
    const inspection = findInspection(req.params.id);

    if (!inspection) {
      return res.status(404).json({
        error: 'Inspection not found.'
      });
    }

    try {
      const filename = `${inspection.id}-report.pdf`;
      const pdfPath = path.join(REPORTS_DIR, filename);

      await generateReportPdf(
        inspection,
        pdfPath,
        origin(req)
      );

      const updated = updateInspection(
        inspection.id,
        item => {
          item.report = {
            filename,
            generatedAt: new Date().toISOString()
          };

          item.reportOutOfDate = false;
          item.status = 'Report Generated';
          item.updatedAt = new Date().toISOString();
        }
      );

      res.json({
        ok: true,
        report: updated.report,
        pdfUrl: `/api/admin/inspections/${inspection.id}/pdf`
      });
    } catch (err) {
      console.error('PDF generation failed:', err);

      res.status(500).json({
        error: `PDF generation failed: ${err.message}`
      });
    }
  }
);

router.get(
  '/admin/inspections/:id/pdf',
  requireAdmin,
  (req, res) => {
    const inspection = findInspection(req.params.id);

    if (!inspection || !inspection.report?.filename) {
      return res.status(404).json({
        error: 'Generate a PDF report first.'
      });
    }

    const file = path.join(
      REPORTS_DIR,
      inspection.report.filename
    );

    if (!fs.existsSync(file)) {
      return res.status(404).json({
        error: 'PDF file not found. Generate the report again.'
      });
    }

    res.download(file, `${inspection.id}-report.pdf`);
  }
);

// --------------------------------------------------
// DOWNLOAD ZIP
// --------------------------------------------------

router.get(
  '/admin/inspections/:id/download-zip',
  requireAdmin,
  (req, res) => {
    const inspection = findInspection(req.params.id);

    if (!inspection) {
      return res.status(404).json({
        error: 'Inspection not found.'
      });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${inspection.id}-inspection.zip"`
    );

    const archive = archiver('zip', {
      zlib: { level: 6 }
    });

    archive.on('error', err => {
      console.error(err);

      if (!res.headersSent) {
        res.status(500).end('Could not create ZIP.');
      } else {
        res.end();
      }
    });

    archive.pipe(res);

    const folder = path.join(
      UPLOADS_DIR,
      inspection.id
    );

    for (const media of inspection.media || []) {
      const file = path.join(folder, media.filename);

      if (fs.existsSync(file)) {
        archive.file(file, {
          name:
            `original-media/` +
            `${media.category.toLowerCase()}-` +
            `${safeFilename(media.originalName || media.filename)}`
        });
      }
    }

    if (inspection.report?.filename) {
      const pdfPath = path.join(
        REPORTS_DIR,
        inspection.report.filename
      );

      if (fs.existsSync(pdfPath)) {
        archive.file(pdfPath, {
          name: 'latest-report.pdf'
        });
      }
    }

    const exportRecord = {
      id: inspection.id,
      status: inspection.status,
      createdAt: inspection.createdAt,
      updatedAt: inspection.updatedAt,
      details: inspection.details || {},
      media: (inspection.media || []).map(
        ({
          id,
          category,
          label,
          originalName,
          mimeType,
          size,
          uploadedAt
        }) => ({
          id,
          category,
          label,
          originalName,
          mimeType,
          size,
          uploadedAt
        })
      )
    };

    archive.append(
      JSON.stringify(exportRecord, null, 2),
      { name: 'inspection-data.json' }
    );

    const headers = [
      'category',
      'label',
      'originalName',
      'mimeType',
      'size',
      'uploadedAt'
    ];

    const csvCell = value =>
      '"' + String(value ?? '').replace(/"/g, '""') + '"';

    const csv = [
      headers.join(','),
      ...exportRecord.media.map(media =>
        headers.map(h => csvCell(media[h])).join(',')
      )
    ].join('\n');

    archive.append(csv, {
      name: 'media-list.csv'
    });

    archive.finalize();
  }
);

// --------------------------------------------------
// PDF GENERATION HELPERS
// --------------------------------------------------

async function generateReportPdf(
  inspection,
  target,
  appOrigin
) {
  const d = inspection.details || {};
  const media = inspection.media || [];

  const doc = new PDFDocument({
    size: 'A4',
    margin: 42,
    bufferPages: false,
    info: {
      Title: `Vehicle Valuation Report - ${inspection.id}`,
      Author: d.companyName || 'Vehicle Inspection Portal'
    }
  });

  const out = fs.createWriteStream(target);

  const finished = new Promise((resolve, reject) => {
    out.on('finish', resolve);
    out.on('error', reject);
    doc.on('error', reject);
  });

  doc.pipe(out);

  const blue = '#173B63';
  const pale = '#EDF3F8';
  const pageW = 595.28;

  const text = value =>
    String(value ?? '').trim() || '—';

  const heading = (
    title,
    subtitle = 'VEHICLE INSPECTION & VALUATION'
  ) => {
    doc.rect(0, 0, pageW, 74).fill(blue);

    doc.fillColor('#FFFFFF')
      .font('Helvetica-Bold')
      .fontSize(15)
      .text(
        text(d.companyName) === '—'
          ? 'VEHICLE VALUATION REPORT'
          : d.companyName,
        42,
        18,
        { width: 350 }
      );

    doc.font('Helvetica')
      .fontSize(8)
      .text(text(d.companyAddress), 42, 42, {
        width: 350
      });

    doc.font('Helvetica-Bold')
      .fontSize(10)
      .text(title, 42, 92, { width: 500 });

    doc.fillColor('#526273')
      .font('Helvetica')
      .fontSize(7)
      .text(subtitle, 42, 109);

    doc.fillColor('#111827');
  };

  const footer = pageNumber => {
    doc.moveTo(42, 802)
      .lineTo(553, 802)
      .strokeColor('#CBD5E1')
      .stroke();

    doc.fillColor('#526273')
      .font('Helvetica')
      .fontSize(7)
      .text(text(d.companyAddress), 42, 811, {
        width: 380
      });

    doc.text(
      `Reference: ${
        text(d.reportReference) !== '—'
          ? d.reportReference
          : inspection.id
      }   |   Page ${pageNumber} of 6`,
      42,
      824,
      {
        align: 'right',
        width: 511
      }
    );

    doc.fillColor('#111827');
  };

  const section = (title, y) => {
    doc.roundedRect(42, y, 511, 22, 3).fill(pale);

    doc.fillColor(blue)
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(title, 50, y + 6, { width: 490 });

    doc.fillColor('#111827');

    return y + 30;
  };

  const field = (label, value, x, y, width = 245) => {
    doc.fillColor('#64748B')
      .font('Helvetica')
      .fontSize(7)
      .text(label.toUpperCase(), x, y, {
        width
      });

    doc.fillColor('#111827')
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(text(value), x, y + 10, {
        width,
        height: 28,
        ellipsis: true
      });
  };

  // Correct media lookup: no undefined find() function.
  const getMediaByCategory = key =>
    (Array.isArray(media) ? media : [])
      .find(item => item.category === key) || null;

  const drawPhoto = (item, x, y, width, height) => {
    doc.roundedRect(x, y, width, height, 4)
      .lineWidth(0.7)
      .strokeColor('#CBD5E1')
      .stroke();

    const placeholder = message => {
      doc.fillColor('#64748B')
        .font('Helvetica')
        .fontSize(8)
        .text(message, x + 8, y + height / 2 - 5, {
          width: width - 16,
          align: 'center'
        });

      doc.fillColor('#111827');
    };

    if (!item) {
      placeholder('Photo not uploaded');
      return;
    }

    const safeName = path.basename(
      String(item.filename || '')
    );

    const inspectionFolder = path.resolve(
      UPLOADS_DIR,
      inspection.id
    );

    const filePath = path.resolve(
      inspectionFolder,
      safeName
    );

    if (
      !filePath.startsWith(inspectionFolder + path.sep) ||
      !fs.existsSync(filePath)
    ) {
      console.error(
        'PDF image file missing or invalid:',
        filePath
      );

      placeholder('Image file not found');
      return;
    }

    const extension = path.extname(filePath).toLowerCase();

    const mime = String(item.mimeType || '')
      .toLowerCase()
      .split(';')[0];

    const isImage =
      ['.jpg', '.jpeg', '.png'].includes(extension) ||
      ['image/jpeg', 'image/png'].includes(mime);

    if (!isImage) {
      console.error(
        'Unsupported PDF image format:',
        { filePath, mime, extension }
      );

      placeholder('Unsupported image format');
      return;
    }

    try {
      // PDFKit embeds the actual image file in the PDF.
      doc.image(filePath, x + 4, y + 4, {
        fit: [width - 8, height - 27],
        align: 'center',
        valign: 'center'
      });

      doc.fillColor('#111827')
        .font('Helvetica-Bold')
        .fontSize(7)
        .text(
          item.label || 'Vehicle Photo',
          x + 6,
          y + height - 17,
          {
            width: width - 12,
            align: 'center'
          }
        );
    } catch (error) {
      console.error(
        'PDF image embedding failed:',
        filePath,
        error
      );

      placeholder('Could not render image');
    }
  };

  // PAGE 1: SUMMARY AND VEHICLE IDENTITY

  heading('Vehicle Valuation Summary');

  let y = 135;

  y = section('REPORT / INSPECTION DETAILS', y);

  field(
    'Report Reference',
    d.reportReference || inspection.id,
    46,
    y,
    245
  );

  field(
    'Report Date',
    d.reportDate || inspection.createdAt?.slice(0, 10),
    310,
    y,
    235
  );

  y += 47;

  field('Bank / Finance Company', d.bankName, 46, y, 245);
  field('Inspection Location', d.inspectionLocation, 310, y, 235);

  y += 47;

  field('Inspector / Valuer', d.inspectorName, 46, y, 245);
  field('Inspection ID', inspection.id, 310, y, 235);

  y = section('VEHICLE DETAILS', y + 36);

  field('Registration Number', d.registrationNumber, 46, y, 245);
  field('Vehicle Category', d.vehicleCategory, 310, y, 235);

  y += 44;

  field('Manufacturer / Make', d.manufacturer, 46, y, 245);
  field('Model', d.model, 310, y, 235);

  y += 44;

  field('Manufacturing Year', d.manufactureYear, 46, y, 245);
  field('Registration Date', d.registrationDate, 310, y, 235);

  y += 44;

  field('Chassis Number', d.chassisNumber, 46, y, 245);
  field('Engine Number', d.engineNumber, 310, y, 235);

  y += 44;

  field('Body Type', d.bodyType, 46, y, 245);

  field(
    'Fuel / Colour',
    [d.fuelType, d.colour].filter(Boolean).join(' / '),
    310,
    y,
    235
  );

  y += 44;

  field(
    'Odometer Reading',
    d.odometer ? `${d.odometer} km` : '',
    46,
    y,
    245
  );

  field('Overall Condition', d.overallCondition, 310, y, 235);

  y = section('VALUATION', y + 32);

  field(
    'Estimated Market Value',
    d.valuationAmount ? `INR ${d.valuationAmount}` : '',
    46,
    y,
    245
  );

  field(
    'Invoice Cost',
    d.invoiceCost ? `INR ${d.invoiceCost}` : '',
    310,
    y,
    235
  );

  footer(1);

  // PAGE 2: OWNER AND DOCUMENTS

  doc.addPage();
  heading('Owner, Registration & Document Details');

  y = 135;

  y = section('OWNER / CUSTOMER', y);

  field('Name', d.customerName, 46, y, 490);

  y += 46;

  field('Address', d.customerAddress, 46, y, 490);

  y += 50;

  y = section('DOCUMENT STATUS', y + 12);

  field('Insurance Details', d.insuranceDetails, 46, y, 245);
  field('Fitness Status', d.fitnessStatus, 310, y, 235);

  y += 48;

  field('Permit Status', d.permitStatus, 46, y, 245);
  field('Tax Status', d.taxStatus, 310, y, 235);

  y += 55;

  y = section('PHYSICAL VERIFICATION / REMARKS', y + 5);

  doc.font('Helvetica')
    .fontSize(9)
    .fillColor('#111827')
    .text(text(d.remarks), 48, y, {
      width: 495,
      height: 100
    });

  y += 125;

  field('Inspection Status', inspection.status, 46, y, 245);

  field(
    'Record Created',
    new Date(inspection.createdAt).toLocaleString(),
    310,
    y,
    235
  );

  footer(2);

  // PAGE 3: CONDITION CHECKLIST

  doc.addPage();
  heading('Vehicle Condition Checklist');

  y = 135;

  y = section('INSPECTION FINDINGS', y);

  const checklist = [
    ['Engine', d.engineCondition],
    ['Transmission / Gearbox', d.transmissionCondition],
    ['Brakes', d.brakesCondition],
    ['Steering', d.steeringCondition],
    ['Suspension', d.suspensionCondition],
    ['Electrical System', d.electricalCondition],
    ['Battery', d.batteryCondition],
    ['Tyres', d.tyreCondition],
    ['Body / Cabin', d.bodyCondition],
    ['Chassis', d.chassisCondition],
    ['Interior', d.interiorCondition]
  ];

  doc.rect(42, y, 511, 24).fill(blue);

  doc.fillColor('#FFFFFF')
    .font('Helvetica-Bold')
    .fontSize(8)
    .text('Component', 50, y + 8);

  doc.text('Reported Condition', 260, y + 8);

  y += 24;

  checklist.forEach((row, index) => {
    if (index % 2 === 0) {
      doc.rect(42, y, 511, 34).fill('#F6F8FB');
    }

    doc.fillColor('#111827')
      .font('Helvetica')
      .fontSize(9)
      .text(row[0], 50, y + 11, { width: 195 });

    doc.font('Helvetica-Bold')
      .text(text(row[1]), 260, y + 11, {
        width: 280
      });

    y += 34;
  });

  y = section('VALUATION NOTES', y + 20);

  field(
    'Estimated Repair Cost',
    d.estimatedRepairCost
      ? `INR ${d.estimatedRepairCost}`
      : '',
    46,
    y,
    245
  );

  field('Estimated Remaining Life', d.remainingLife, 310, y, 235);

  y += 52;

  field('Overall Assessment', d.overallCondition, 46, y, 490);

  footer(3);

  // PHOTO PAGES

  const photoPage = (pageNumber, title, keys) => {
    doc.addPage();
    heading(title);

    const cells = [
      { x: 42, y: 140, w: 246, h: 250, key: keys[0] },
      { x: 307, y: 140, w: 246, h: 250, key: keys[1] },
      { x: 42, y: 408, w: 246, h: 250, key: keys[2] },
      { x: 307, y: 408, w: 246, h: 250, key: keys[3] }
    ];

    cells.forEach(cell => {
      drawPhoto(
        getMediaByCategory(cell.key),
        cell.x,
        cell.y,
        cell.w,
        cell.h
      );
    });

    footer(pageNumber);
  };

  // PAGE 4: EXTERIOR PHOTOGRAPHS

  photoPage(
    4,
    'Vehicle Photographs — Exterior',
    ['FRONT', 'REAR', 'LEFT', 'RIGHT']
  );

  // PAGE 5: IDENTIFICATION PHOTOGRAPHS

  photoPage(
    5,
    'Vehicle Photographs — Identification & Other Views',
    [
      'CHASSIS_IMPRINT',
      'CHASSIS_NUMBER',
      'ENGINE_PLATE',
      'ENGINE_IMAGE'
    ]
  );

  // PAGE 6: ODOMETER, INTERIOR, DAMAGE, VIDEO AND DECLARATION

  doc.addPage();
  heading('Media, Remarks & Declaration');

  y = 132;

  drawPhoto(
    getMediaByCategory('ODOMETER'),
    42,
    y,
    245,
    145
  );

  drawPhoto(
    getMediaByCategory('INTERIOR'),
    308,
    y,
    245,
    145
  );

  y += 162;

  y = section('ADDITIONAL DAMAGE PHOTOS', y);

  const damages = [
    'DAMAGE_1',
    'DAMAGE_2',
    'DAMAGE_3',
    'DAMAGE_4'
  ]
    .map(key => getMediaByCategory(key))
    .filter(Boolean);

  if (damages.length === 0) {
    doc.font('Helvetica')
      .fontSize(8)
      .fillColor('#526273')
      .text(
        'No additional damage photos uploaded.',
        48,
        y + 3
      );

    y += 21;
  } else {
    damages.slice(0, 4).forEach((item, index) => {
      drawPhoto(
        item,
        42 + (index % 2) * 265,
        y + Math.floor(index / 2) * 80,
        245,
        72
      );
    });

    y += Math.ceil(damages.length / 2) * 82;
  }

  y = section('VIDEO / QR ACCESS', y + 5);

  const video = getMediaByCategory('SHORT_VIDEO');

  if (video) {
    const videoUrl =
      `${appOrigin}/media/${inspection.uploadToken}/${video.id}`;

    doc.fillColor('#1D4ED8')
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(
        'Open inspection video',
        48,
        y + 4,
        { link: videoUrl, underline: true }
      );

    try {
      const qrBuffer = await QRCode.toBuffer(videoUrl, {
        type: 'png',
        width: 90,
        margin: 1
      });

      doc.image(qrBuffer, 455, y - 7, {
        width: 65
      });
    } catch (_error) {
      doc.font('Helvetica')
        .fontSize(7)
        .fillColor('#64748B')
        .text('QR unavailable', 445, y + 10);
    }
  } else {
    doc.font('Helvetica')
      .fontSize(8)
      .fillColor('#526273')
      .text('No walk-around video uploaded.', 48, y + 4);
  }

  y += 66;

  y = section('DECLARATION / DISCLAIMER', y);

  const disclaimer =
    text(d.disclaimer) === '—'
      ? 'This report is based on the information and inspection findings recorded by the inspecting professional. Valuation and condition findings must be verified and approved by the responsible surveyor/valuer before official use.'
      : d.disclaimer;

  doc.font('Helvetica')
    .fontSize(7.5)
    .fillColor('#111827')
    .text(disclaimer, 48, y + 1, {
      width: 495,
      height: 42
    });

  y += 50;

  field(
    'Surveyor / Valuer',
    d.inspectorSignatureName || d.inspectorName,
    46,
    y,
    245
  );

  field('Overall Condition', d.overallCondition, 310, y, 235);

  footer(6);

  doc.end();
  await finished;
}

module.exports = router;