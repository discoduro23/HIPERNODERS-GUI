const net = require('net');
const fs = require('fs');
const crypto = require('crypto');
const cacheFile = 'resourcesCache.json';
const defaultHeaders = {
  'x-api-key': 'hiperKEY_24',
};
const options = {
  port: 3008,
  host: '176.31.196.25'
};

let dh;
let secret;

function getCache() {
  if (fs.existsSync(cacheFile)) {
    const cacheData = fs.readFileSync(cacheFile);
    const cachedResources = JSON.parse(cacheData);
    if (cachedResources && cachedResources.length > 0) {
      return cachedResources;
    }
  }
  return {};
}

function setCacheHeaders(cachedResources) {
  if (cachedResources && cachedResources.length > 0) {
    return cachedResources[0].lastModified;
  } else {
    delete defaultHeaders['If-Modified-Since'];
  }
  return null;
}

function establishSharedSecret() {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(options, () => {
      console.log('Conectado al servidor');
    });

    client.on('data', (data) => {
      const message = JSON.parse(data.toString());
      switch (message.type) {
        case 'dh-params':
          const prime = Buffer.from(message.prime, 'hex');
          const generator = Buffer.from(message.generator, 'hex');
          dh = crypto.createDiffieHellman(prime, generator);
          const clientKeys = dh.generateKeys();
          secret = dh.computeSecret(Buffer.from(message.publicKey, 'hex'));
          console.log('Secreto compartido generado:', secret.toString('hex'));

          client.write(JSON.stringify({
            type: 'client-key',
            publicKey: clientKeys.toString('hex')
          }));
          break;

        case 'key-exchange-complete':
          console.log('Intercambio de claves completado con éxito');
          resolve(secret);
          break;

        default:
          console.log('Tipo de mensaje no reconocido:', message.type);
          reject(new Error('Tipo de mensaje no reconocido'));
      }
    });

    client.on('end', () => {
      console.log('Desconectado del servidor');
    });

    client.on('error', (err) => {
      console.error('Error:', err);
      reject(err);
    });
  });
}

function sendRequest(url, method, headers, body) {
  return new Promise((resolve, reject) => {
    headers['If-Modified-Since'] = setCacheHeaders(getCache());
    const urlObj = new URL(url);
    const options = {
      host: urlObj.hostname,
      port: urlObj.port || 3008,
    };

    const client = net.createConnection(options, () => {
      console.log('Connected to server');
      let requestData = `${method} ${urlObj.pathname} HTTP/1.1\r\n`;

      // Add automatic headers
      const defaultHeaders = {
        'Content-Type': 'application/json',
        'Content-Length': body ? Buffer.byteLength(JSON.stringify(body)) : 0,
        'Host': urlObj.hostname,
        'Connection': 'keep-alive',
        'Accept': '*/*',
        'User-Agent': 'HiperNodeJSClient/1.0.0',
      };

      const allHeaders = { ...defaultHeaders, ...headers };

      Object.entries(allHeaders).forEach(([key, value]) => {
        requestData += `${key}: ${value}\r\n`;
      });

      requestData += '\r\n';

      if (body) {
        requestData += JSON.stringify(body);
      }

      client.write(encryptData(requestData, secret));
    });

    let encryptedResponseData = '';
    let statusCode = null;
    let statusMessage = null;
    let responseHeaders = {};

    client.on('data', (chunk) => {
      encryptedResponseData += chunk.toString();
    });

    client.on('end', () => {
      console.log("Mensaje del servidor recibido (cifrado):", encryptedResponseData);

      // Asumir que solo la última parte es el mensaje cifrado
      const jsonPartEnd = encryptedResponseData.indexOf('}') + 1;
      const encryptedMessage = encryptedResponseData.slice(jsonPartEnd);

      const responseData = decryptData(encryptedMessage, secret);
      console.log("Mensaje descifrado:", responseData);

      if (!responseData) {
        reject(new Error('Failed to decrypt response'));
        return;
      }
      const endOfHeaders = responseData.indexOf('\r\n\r\n');
      if (endOfHeaders !== -1) {
        const headersRaw = responseData.substring(0, endOfHeaders).split('\r\n');
        const statusLine = headersRaw.shift(); // Remove HTTP status line
        headersRaw.forEach(header => {
          const [key, value] = header.split(': ');
          responseHeaders[key] = value;
        });
        const statusLineParts = statusLine.split(' ');
        statusCode = parseInt(statusLineParts[1]);
        statusMessage = statusLineParts.slice(2).join(' ');
        const responseBody = responseData.substring(endOfHeaders + 4);

        const response = {
          statusCode,
          statusMessage,
          headers: responseHeaders,
          body: responseBody,
          method: method,
        };
        handleResponse(response);
        resolve(response);
      } else {
        reject(new Error('Response format invalid'));
      }
      client.destroy();
    });

    client.on('error', (err) => {
      console.error('Error:', err);
      reject(err);
      client.destroy();
    });
  });
}

function encryptData(plaintext, secret) {
  const iv = crypto.randomBytes(16);
  console.log("Generated IV (encrypt):", iv.toString('hex'));
  const key = crypto.createHash('sha256').update(secret).digest().slice(0, 32);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  console.log("plaintext: ", plaintext);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + encrypted;
}

function decryptData(encrypted, secret) {
  try {
    const iv = Buffer.from(encrypted.slice(0, 32), 'hex');
    const encryptedData = encrypted.slice(32);
    const key = crypto.createHash('sha256').update(secret).digest().slice(0, 32);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error("Decryption failed:", err);
    return null;
  }
}

function handleResponse(response) {
  console.log("Response:\n", response);
  if (response.statusCode === 200) {
    if (response.method === 'GET') {
      fs.writeFileSync(cacheFile, response.body);
      console.log('Resources saved to cache.');
      console.log('Cached resources:', JSON.parse(response.body));
    } else {
      console.log('200 OK.');
    }
  } else if (response.statusCode === 201) {
    console.log('Resource created successfully.');
  } else if (response.statusCode === 204) {
    console.log('Resource updated successfully.');
  } else if (response.statusCode === 304) {
    const cachedResources = getCache();
    console.log('Resources are up-to-date.');
    console.log('Cached resources:', cachedResources);
  } else if (response.statusCode === 400) {
    console.log('Bad request:', response.statusMessage);
  } else if (response.statusCode === 401) {
    console.log('Unauthorized:', response.statusMessage);
  } else if (response.statusCode === 403) {
    console.log('Forbidden:', response.statusMessage);
  } else if (response.statusCode === 404) {
    console.log('Resource not found:', response.statusMessage);
  } else {
    console.log('Unexpected status:', response.statusCode, response.statusMessage);
  }
}

module.exports = {
  establishSharedSecret,
  sendRequest,
  defaultHeaders: {
    'x-api-key': 'hiperKEY_24',
  }
};
