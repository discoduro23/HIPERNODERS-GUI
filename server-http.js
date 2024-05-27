const express = require('express');
const fs = require('fs');
const multer = require('multer');
const dotenv = require('dotenv').config();
const os = require('os');
const CONST = require('./modules/constants.js');

const app = express();

const upload = multer({ dest: 'images/' });

const resourcesPath = 'data/resources.json';
let resources = [];

let lastModified;

function log(level, message) {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} - ${level.toUpperCase()} - ${message}\n`;
  fs.appendFileSync('server.log', logMessage);
  console.log(logMessage);
}

function loadJson() {
  fs.readFile(resourcesPath, (err, data) => {
    if (err) throw err;
    resources = JSON.parse(data);
    updateLastModified();
  });
}

function saveResources() {
  fs.writeFile(resourcesPath, JSON.stringify(resources), err => {
    if (err) {
      log('ERROR', 'Error saving resources: ' + err);
      return;
    }
    updateLastModified();
  });
}

function updateLastModified() {
  const firstResource = resources[0];
  if (firstResource) {
    lastModified = firstResource.lastModified;
  } else {
    lastModified = new Date().toISOString();
  }
}

loadJson();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  log('INFO', `[REQUEST] ${req.method} ${req.url} - IP: ${req.ip}`);
  next();
});

app.use('/resources', (req, res, next) => {
  const ifModifiedSince = req.headers['if-modified-since'];
  if (ifModifiedSince && new Date(ifModifiedSince) >= new Date(lastModified)) {
    log('INFO', 'Resources not modified, using cache');
    res.status(304).end();
  } else {
    res.set('if-modified-since', lastModified);
    next();
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '/staticHtml/apiRoot.html'));
  log('INFO', 'API Root HTML served');
});

app.route('/resources')
  .get((req, res) => {
    res.status(200).json(resources);
    log('INFO', 'Resources fetched');
  })
  .post((req, res) => {
    const newResource = {
      id: resources.length + 1,
      nombre: req.body.nombre || "N/A",
      provincias: req.body.provincias || ["N/A"]
    };
    resources.push(newResource);
    saveResources();
    res.status(201).send(`Resource added successfully with ID ${newResource.id}`);
    log('INFO', `Resource added with ID ${newResource.id}`);
  });

app.post('/images', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded');
  }
  res.status(201).send(`Image saved as ${req.file.filename}`);
  log('INFO', `Image uploaded: ${req.file.filename}`);
});

const networkInterfaces = os.networkInterfaces();
let ip;
for (let iface in networkInterfaces) {
  for (let version of networkInterfaces[iface]) {
    if (version.family === 'IPv4' && !version.internal) {
      ip = version.address;
    }
  }
}

const port = 3008;

app.listen(port, () => {
  log('INFO', `Server running on http://${ip}:${port}`);
});
