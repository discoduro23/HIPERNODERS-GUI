const fs = require('fs');
const os = require('os');
const net = require('net');
const crypto = require('crypto');
const dotenv = require('dotenv').config();
const CONST = require('./modules/constants.js');

const resourcesPath = 'data/resources.json';
const usersPath = 'data/usersdb.json';
const imagesDir = 'images/';

console.log("Generando clave");
const dh = crypto.createDiffieHellman(2048);
const serverKeys = dh.generateKeys();
console.log('Llave pública del servidor:', serverKeys.toString('hex'));

if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir);
}

const logStream = fs.createWriteStream('server.log', { flags: 'a' });
const API_KEY = dotenv.parsed.API_KEY;

let resources = [];
let userdb = [];
let lastResourceId = 0;

function log(level, message) {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} - ${level.toUpperCase()} - ${message}\n`;
  logStream.write(logMessage);
  console.log(logMessage);
}

function loadJson() {
  fs.readFile(resourcesPath, (err, data) => {
    if (err) throw err;
    resources = JSON.parse(data);
    if (!resources[0].lastModified) {
      resources[0].lastModified = new Date().toISOString();
      saveResources();
    }
    if (resources.length > 0) {
      lastResourceId = resources[resources.length - 1].id;
    }
  });

  fs.readFile(usersPath, (err, data) => {
    if (err) throw err;
    userdb = JSON.parse(data);
  });
}

loadJson();

function saveResources() {
  resources[0].lastModified = new Date().toISOString();
  fs.writeFile(resourcesPath, JSON.stringify(resources), err => {
    if (err) {
      console.error('Error al guardar los recursos:', err);
    }
  });
}

function writePacket(socket, statusCode, statusMessage, contentType, body, headers) {
  let response = `HTTP/1.1 ${statusCode} ${statusMessage}\r\n`;
  if (contentType) {
    response += `Content-Type: ${contentType}\r\n`;
  }
  if (headers) {
    for (let key in headers) {
      response += `${key}: ${headers[key]}\r\n`;
    }
  }
  response += '\r\n';
  if (body) {
    response += body;
  }
  socket.write(response, () => {
    socket.end();
  });
}

let secret;
const server = net.createServer((socket) => {
  log('INFO', '[CLIENT START]');

  const params = {
    type: 'dh-params',
    prime: dh.getPrime().toString('hex'),
    generator: dh.getGenerator().toString('hex'),
    publicKey: serverKeys.toString('hex')
  };
  socket.write(JSON.stringify(params));

  socket.on('data', (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch (error) {
      console.error('Error al parsear el mensaje:', error);
      return;
    }

    switch (message.type) {
      case 'client-key':
        try {
          const clientPublicKey = Buffer.from(message.publicKey, 'hex');
          secret = dh.computeSecret(clientPublicKey);
          console.log('\nSecreto compartido establecido:', secret.toString('hex'));

          socket.write(JSON.stringify({ type: 'key-exchange-complete' }));
        } catch (error) {
          console.error('\nError al establecer el secreto compartido:', error);
          socket.write(JSON.stringify({ type: 'error', message: 'Failed to establish shared secret' }));
          socket.end();
        }
        break;
      case 'secure-message':
        console.log('\nConversación segura iniciada\n');
        try {
          if (!secret) {
            throw new Error('Secreto compartido no establecido.');
          }
          const decryptedMessage = decryptData(message.data, secret);
          console.log('\nMensaje descifrado del cliente:', decryptedMessage);
          processRequest(socket, decryptedMessage);
        } catch (error) {
          console.error('\nError al descifrar mensaje:', error);
          socket.write(JSON.stringify({ type: 'error', message: 'Failed to decrypt message' }));
        }
        break;
      default:
        console.log('\nTipo de mensaje no reconocido:', message.type);
    }
  });

  socket.on('end', () => log('INFO', '[CLIENT END]'));
  socket.on('error', (err) => {
    log('ERROR', `Socket error: ${err.message}`);
  });
});

function processRequest(socket, requestData) {
  const requestString = requestData.toString();
  const lines = requestString.split('\r\n');
  const requestLine = lines[0] ? lines[0].split(' ') : [];

  if (requestLine.length < 2) {
    writePacket(socket, CONST.CODE_400, CONST.CODE_400_MESSAGE);
    log('ERROR', 'Invalid request line');
    return;
  }

  const method = requestLine[0];
  const [path, queryParams] = requestLine[1].split('?');
  const params = new URLSearchParams(queryParams || '');

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key'
  };
  for (let i = 1; i < lines.length; i++) {
    const [key, value] = lines[i].split(': ');
    headers[key.toLowerCase()] = value;
  }
  if (headers['x-api-key'] !== API_KEY) {
    writePacket(socket, CONST.CODE_403, CONST.CODE_403_MESSAGE);
    log('ERROR', 'Invalid API key');
    return;
  }

  if (method === 'GET' && path === '/resources') {
    const ifModifiedSince = headers['if-modified-since'];
    const lastModified = resources[0].lastModified;

    if (ifModifiedSince && new Date(ifModifiedSince) >= new Date(lastModified)) {
      writePacket(socket, CONST.CODE_304, CONST.CODE_304_MESSAGE);
      log('INFO', 'Resources not modified since last request');
    } else {
      writePacket(socket, CONST.CODE_200, CONST.CODE_200_MESSAGE, 'application/json', JSON.stringify(resources));
      log('INFO', 'Resources sent');
    }
  } else if (method === 'POST' && path === '/resources') {
    let body = '';
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === '') {
        body = lines.slice(i + 1).join('\r\n');
        break;
      }
    }

    if (body === '') {
      writePacket(socket, CONST.CODE_400, CONST.CODE_400_MESSAGE);
      log('ERROR', 'Empty body');
      return;
    }

    const resourceContent = JSON.parse(body);
    const newResourceId = ++lastResourceId;
    const resource = {
      id: newResourceId,
      nombre: resourceContent.nombre ?? "N/A",
      provincias: resourceContent.provincias ?? ["N/A"]
    };
    resources.push(resource);
    saveResources();

    writePacket(socket, CONST.CODE_201, CONST.CODE_201_MESSAGE, 'text/plain', `Resource added successfully with ID ${newResourceId}`);
    log('INFO', `Resource added with ID ${newResourceId}`);
  } else if (method === 'PUT' && path === '/resources') {
    const resourceId = parseInt(params.get('id'));
    const resourceIndex = resources.findIndex(resource => resource.id === resourceId);
    if (resourceIndex !== -1) {
      let body = '';
      for (let i = 0; i < lines.length; i++) {
        if (lines[i] === '') {
          body = lines.slice(i + 1).join('\r\n');
          break;
        }
      }

      const resourceContent = JSON.parse(body);

      resources[resourceIndex].nombre = resourceContent.nombre ?? resources[resourceIndex].nombre;
      resources[resourceIndex].provincias = resourceContent.provincias ?? resources[resourceIndex].provincias;
      saveResources();
      writePacket(socket, CONST.CODE_200, CONST.CODE_200_MESSAGE, 'text/plain', 'Resource updated successfully');
      log('INFO', `Resource updated with ID ${resourceId}`);
    } else {
      writePacket(socket, CONST.CODE_404, CONST.CODE_404_MESSAGE);
      log('ERROR', `Resource not found with ID ${resourceId}`);
    }
  } else if (method === 'DELETE' && path === '/resources') {
    const resourceId = parseInt(params.get('id'));
    const resourceIndex = resources.findIndex(resource => resource.id === resourceId);
    if (resourceIndex !== -1) {
      resources.splice(resourceIndex, 1);
      saveResources();
      writePacket(socket, CONST.CODE_200, CONST.CODE_200_MESSAGE, 'text/plain', 'Resource deleted successfully');
      log('INFO', `Resource deleted with ID ${resourceId}`);
    } else {
      writePacket(socket, CONST.CODE_404, CONST.CODE_404_MESSAGE);
      log('ERROR', `Resource not found with ID ${resourceId}`);
    }
  } else if (method === 'POST' && path === '/images') {
    const boundary = headers['content-type'].split('boundary=')[1];

    const splitBuffer = (buffer, separator) => {
      let parts = [];
      let start = 0;
      let index;
      while ((index = buffer.indexOf(separator, start)) !== -1) {
        parts.push(buffer.slice(start, index));
        start = index + separator.length;
      }
      parts.push(buffer.slice(start));
      return parts;
    };

    const parts = splitBuffer(requestData, Buffer.from(`--${boundary}`)).filter(part => part.length > 0 && part.toString().trim() !== '--');

    const filePart = parts.find(part => part.includes('filename='));
    if (!filePart) {
      writePacket(socket, CONST.CODE_400, CONST.CODE_400_MESSAGE, 'text/plain', 'No file uploaded');
      log('ERROR', 'No file uploaded');
      return;
    }

    const contentDispositionMatch = filePart.toString().match(/Content-Disposition: form-data; name="file"; filename="(.+)"/);
    const contentTypeMatch = filePart.toString().match(/Content-Type: (.+)/);

    if (!contentDispositionMatch || !contentTypeMatch) {
      writePacket(socket, CONST.CODE_400, CONST.CODE_400_MESSAGE, 'text/plain', 'Invalid file upload');
      log('ERROR', 'Invalid file upload');
      return;
    }

    const filename = contentDispositionMatch[1].trim();

    const filePartString = filePart.toString();
    const lines = filePartString.split('\r\n');

    let dataStartIndex = 0;
    let typeofimage = '';
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('Content-Type: image/')) {
        typeofimage = lines[i].split('image/')[1];
        if (i + 2 < lines.length) {
          dataStartIndex = filePartString.indexOf(lines[i + 2]);
        }
        break;
      }
    }

    if (typeofimage === '') {
      writePacket(socket, CONST.CODE_405, CONST.CODE_405_MESSAGE, 'text/plain', 'Invalid file type');
      log('ERROR', 'Invalid file type');
      return;
    }

    const fileDataEndIndex = filePart.indexOf(Buffer.from('\r\n--'), dataStartIndex);

    const fileData = (fileDataEndIndex !== -1) ? filePart.slice(dataStartIndex, fileDataEndIndex) : filePart.slice(dataStartIndex);

    const filePath = imagesDir + filename;

    fs.writeFile(filePath, fileData, err => {
      if (err) {
        writePacket(socket, CONST.CODE_500, CONST.CODE_500_MESSAGE);
        log('ERROR', 'Error saving image' + err);
        return;
      }
      writePacket(socket, CONST.CODE_201, CONST.CODE_201_MESSAGE, 'text/plain', `Image saved as ${filename}`);
      log('INFO', `Image saved: ${filename}`);
    });
  } else if (method === 'GET' && path.startsWith('/images')) {
    const filename = path.split('/images/')[1];
    const filePath = imagesDir + filename;

    fs.readFile(filePath, (err, data) => {
      if (err) {
        writePacket(socket, CONST.CODE_404, CONST.CODE_404_MESSAGE);
        log('ERROR', 'Image not found');
        return;
      }
      writePacket(socket, CONST.CODE_200, CONST.CODE_200_MESSAGE, 'image/png', data);
      log('INFO', `Image sent: ${filename}`);
    });
  } else {
    writePacket(socket, CONST.CODE_404, CONST.CODE_404_MESSAGE);
    log('ERROR', `Unknown endpoint: ${path}`);
  }
}

const networkInterfaces = os.networkInterfaces();
let ip;
for (let iface in networkInterfaces) {
  for (let version of networkInterfaces[iface]) {
    if (version.family === 'IPv4' && !version.internal) {
      ip = version.address;
    }
  }
}

function encryptData(plaintext, secret) {
  const iv = crypto.randomBytes(16);
  console.log("Generated IV (encrypt):", iv.toString('hex'));
  const key = crypto.createHash('sha256').update(secret).digest().slice(0, 32);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + encrypted;
}

function decryptData(encrypted, secret) {
  try {
    const iv = Buffer.from(encrypted.slice(0, 32), 'hex');
    encrypted = encrypted.slice(32);
    const key = crypto.createHash('sha256').update(secret).digest().slice(0, 32);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error("Decryption failed:", err);
    return null;
  }
}

const port = process.argv[2] || 3008;
server.listen(port, () => {
  log('INFO', `HiperServer running on http://${ip}:${port}`);
});
