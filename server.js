const fs = require('fs');
const os = require('os');
const net = require('net');
const crypto = require('crypto');
const dotenv = require('dotenv').config();
const CONST = require('./modules/constants.js');

const resourcesPath = 'data/resources.json';
const usersPath = 'data/usersdb.json';
const imagesDir = 'images/';

if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir);
}

function generateToken() {
  return crypto.randomBytes(16).toString('hex');
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
    try {
      resources = JSON.parse(data);
      if (!resources[0].lastModified) {
        resources[0].lastModified = new Date().toISOString();
        saveResources();
      }
      if (resources.length > 0) {
        lastResourceId = resources[resources.length - 1].id;
      }
    } catch (e) {
      // Just 
    }
  });

  fs.readFile(usersPath, (err, data) => {
    if (err) throw err;
    try {
      userdb = JSON.parse(data);
    } catch (error) {
    }
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

function saveUsers() {
  fs.writeFile(usersPath, JSON.stringify(userdb), err => {
    if (err) {
      console.error('Error al guardar los usuarios:', err);
    }
  });
}

function findUser(username) {
  return userdb.find(user => user.username === username);
}

function verifyToken(headers) {
  const token = headers['authorization'];
  console.log(headers)
  if (!token) return false;
  const user = userdb.find(user => user.token === token);
  return user || false;
}

function encryptPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, user) {
  const hash = crypto.pbkdf2Sync(password, user.salt, 1000, 64, 'sha512').toString('hex');
  return user.password === hash;
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
    socket.write(response);
    socket.write(body);
  } else {
    socket.write(response);
  }
  socket.end();
}

const server = net.createServer((socket) => {
  log('INFO', '[CLIENT START]');

  let requestData = Buffer.alloc(0);

  socket.on('data', (chunk) => {
    console.log(chunk)
    requestData = Buffer.concat([requestData, chunk]);

    const requestString = requestData.toString();
    if (requestString.includes('\r\n\r\n')) {
      const headerEndIndex = requestString.indexOf('\r\n\r\n') + 4;
      const contentLengthMatch = requestString.match(/Content-Length: (\d+)/i);
      if (contentLengthMatch) {
        const contentLength = parseInt(contentLengthMatch[1], 10);
        if (requestData.length >= headerEndIndex + contentLength) {
          processRequest(socket, requestData);
          requestData = Buffer.alloc(0);
        }
      } else {
        processRequest(socket, requestData);
        requestData = Buffer.alloc(0);
      }
    }
  });

  socket.on('error', (err) => {
    log('ERROR', `Socket error: ${err.message}`);
  });

  socket.on('end', () => {
    log('INFO', '[CLIENT END]');
  });
});

server.stop = (callback) => {
  server.close((err) => {
    if (err) {
      console.error("Failed to close server", err);
    }
    logStream.end(() => {
      console.log("Log stream closed.");
      callback();
    });
    console.log("Server shut down successfully.");
  });
};

function processRequest(socket, requestData) {
  const requestString = requestData.toString();
  const lines = requestString.split('\r\n');
  const requestLine = lines[0] ? lines[0].split(' ') : [];
  console.log(requestLine)
  if (requestLine.length < 2) {
    writePacket(socket, CONST.CODE_400, CONST.CODE_400_MESSAGE);
    log('ERROR', 'Invalid request line');
    return;
  }

  const method = requestLine[0];
  const [path, queryParams] = requestLine[1].split('?');
  const params = new URLSearchParams(queryParams || '');

  const headers = {};
  for (let i = 1; i < lines.length; i++) {
    const [key, value] = lines[i].split(': ');
    if (key && value) {
      headers[key.toLowerCase()] = value;
    }
  }

  if (headers['x-api-key'] !== API_KEY) {
    writePacket(socket, CONST.CODE_403, CONST.CODE_403_MESSAGE);
    log('ERROR', 'Invalid API key');
    return;
  }

  if (path.startsWith('/loginflow')) {
    handleLoginFlow(socket, method, path, headers, requestData, lines);
  } else {
    if (method === 'GET' && path === '/') {
      // Send a static website (the one inside staticHtml folder)
      fs.readFile('staticHtml/apiRoot.html', (err, data) => {
        if (err) {
          writePacket(socket, CONST.CODE_500, CONST.CODE_500_MESSAGE);
          log('ERROR', 'Error reading apiRoot.html');
          return;
        }
        writePacket(socket, CONST.CODE_200, CONST.CODE_200_MESSAGE, 'text/html', data);
        log('INFO', 'Api Root html sent');
      });
      
    } else if (method === 'GET' && path === '/resources') {
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
      console.log("Contenido de body recibido:", body);
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
    } else if (method === 'DELETE' && path.startsWith('/images')) {
      const filename = path.split('/images/')[1];
      const filePath = imagesDir + filename;

      fs.unlink(filePath, (err) => {
        if (err) {
          writePacket(socket, CONST.CODE_404, CONST.CODE_404_MESSAGE);
          log('ERROR', 'Image not found');
          return;
        }
        writePacket(socket, CONST.CODE_200, CONST.CODE_200_MESSAGE, 'text/plain', `Image ${filename} deleted`);
        log('INFO', `Image deleted: ${filename}`);
      });
    } else if (method === 'POST' && path === '/images') {
      console.log(requestData)
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
      console.log(parts)
      console.log(filePart)
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
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('Content-Type: image/')) {
          if (i + 2 < lines.length) {
            dataStartIndex = filePartString.indexOf(lines[i + 2]);
          }
          break;
        } 
      }
  
      const fileDataEndIndex = filePart.indexOf(Buffer.from('\r\n--'), dataStartIndex);
      const fileData = (fileDataEndIndex !== -1) ? filePart.slice(dataStartIndex, fileDataEndIndex) : filePart.slice(dataStartIndex);
  
      const filePath = imagesDir + filename;
  
      fs.writeFile(filePath, fileData, err => {
        if (err) {
          writePacket(socket, CONST.CODE_500, CONST.CODE_500_MESSAGE);
          log('ERROR', 'Error saving image: ' + err);
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
}



function handleLoginFlow(socket, method, path, headers, requestData, lines) {
  const userPath = path.split('/loginflow/')[1];
  let body = '';
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '') {
      body = lines.slice(i + 1).join('\r\n');
      break;
    }
  }

  if (method === 'POST' && userPath === 'register') {
    const { username, password } = JSON.parse(body);
    if (!username || !password) {
      writePacket(socket, CONST.CODE_400, CONST.CODE_400_MESSAGE, 'text/plain', 'Username and password required');
      log('ERROR', 'Username and password required');
      return;
    }
    if (findUser(username)) {
      writePacket(socket, CONST.CODE_400, CONST.CODE_400_MESSAGE, 'text/plain', 'User already exists');
      log('ERROR', 'User already exists');
      return;
    }

    const { salt, hash } = encryptPassword(password);

    const newUser = {
      id: userdb.length ? userdb[userdb.length - 1].id + 1 : 1,
      username,
      salt,
      password: hash,
      token: null,
    };
    userdb.push(newUser);
    saveUsers();
    writePacket(socket, CONST.CODE_201, CONST.CODE_201_MESSAGE, 'text/plain', 'User registered successfully');
    log('INFO', `User registered: ${username}`);
  } else if (method === 'PUT' && userPath === 'login') {
    const { username, password } = JSON.parse(body);
    const user = findUser(username);
    if (!user || !verifyPassword(password, user)) {
      writePacket(socket, CONST.CODE_401, CONST.CODE_401_MESSAGE, 'text/plain', 'Invalid credentials');
      log('ERROR', 'Invalid credentials');
      return;
    }

    user.token = generateToken();
    saveUsers();
    writePacket(socket, CONST.CODE_200, CONST.CODE_200_MESSAGE, 'application/json', JSON.stringify({ token: user.token }));
    log('INFO', `User logged in: ${username}`);
  } else if (method === 'DELETE' && userPath) {
    const user = findUser(userPath);
    if (!user) {
      writePacket(socket, CONST.CODE_404, CONST.CODE_404_MESSAGE, 'text/plain', 'User not found');
      log('ERROR', 'User not found');
      return;
    }
    userdb = userdb.filter(u => u.username !== userPath);
    saveUsers();
    writePacket(socket, CONST.CODE_200, CONST.CODE_200_MESSAGE, 'text/plain', 'User deleted successfully');
    log('INFO', `User deleted: ${userPath}`);
  } else if (method === 'PUT' && userPath) {
    const authUser = verifyToken(headers);
    if (!authUser) {
      writePacket(socket, CONST.CODE_401, CONST.CODE_401_MESSAGE, 'text/plain', 'Unauthorized');
      log('ERROR', 'Unauthorized');
      return;
    }
    const { password } = JSON.parse(body);
    const user = findUser(userPath);
    if (!user) {
      writePacket(socket, CONST.CODE_404, CONST.CODE_404_MESSAGE, 'text/plain', 'User not found');
      log('ERROR', 'User not found');
      return;
    }
    const { salt, hash } = encryptPassword(password);
    user.salt = salt;
    user.password = hash;
    saveUsers();
    writePacket(socket, CONST.CODE_200, CONST.CODE_200_MESSAGE, 'text/plain', 'User updated successfully');
    log('INFO', `User updated: ${userPath}`);
  } else if (method === 'GET') {
    writePacket(socket, CONST.CODE_200, CONST.CODE_200_MESSAGE, 'application/json', JSON.stringify(userdb));
    log('INFO', 'User list sent');
  } else {
    writePacket(socket, CONST.CODE_404, CONST.CODE_404_MESSAGE, 'text/plain', 'Unknown endpoint');
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

const port = 3008;
const checkPortInUse = (port) => {
  return new Promise((resolve, reject) => {
    const tester = net.createServer()
      .once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          resolve(true);
        } else {
          reject(err);
        }
      })
      .once('listening', () => {
        tester.once('close', () => {
          resolve(false);
        }).close();
      })
      .listen(port);
  });
};

checkPortInUse(port)
  .then((inUse) => {
    if (!inUse) {
      server.listen(port, () => {
        log('INFO', `HiperServer running on http://${ip}:${port}`);
      });
    } else {
      log('ERROR', `Port ${port} is already in use`);
    }
  })
  .catch((err) => {
    log('ERROR', `Error checking port: ${err.message}`);
  });
  
  


module.exports = server;