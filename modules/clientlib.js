const fs = require('fs');
const net = require('net');

const cacheFile = 'resourcesCache.json';

const defaultHeaders = {
  'x-api-key': 'hiperKEY_24',
};

// Load cached resources if available
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

// Function to send HTTP requests
function sendRequest(url, method, headers, body) {
  return new Promise((resolve, reject) => {
    console.log("aaaaaaaaaaaaaaaaaaaaa" + JSON.stringify(headers))
    headers['If-Modified-Since'] = setCacheHeaders(getCache());
    const urlObj = new URL(url);
    const options = {
      host: urlObj.hostname,
      port: urlObj.port || 3008,
    };

    const client = net.createConnection(options, () => {
      console.log('Connected to server');
      let requestData = `${method} ${urlObj.pathname}${urlObj.search} HTTP/1.1\r\n`;
      
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

      client.write(requestData);
    });

    let responseData = ''

    if (urlObj.pathname.startsWith('/images')) {
      responseData = Buffer.alloc(0);
    }

    let statusCode = null;
    let statusMessage = null;
    let responseHeaders = {};

    client.on('data', (chunk) => {
      if (urlObj.pathname.startsWith('/images')) {
        responseData = Buffer.concat([responseData, chunk]);
      } else {
        responseData += chunk.toString();
      }
    });

    client.on('end', () => {
      var responseString = responseData;
      if (urlObj.pathname.startsWith('/images')) {
        responseString = responseData.toString();
      }
      const endOfHeaders = responseString.indexOf('\r\n\r\n');
      if (endOfHeaders !== -1) {
        const headersRaw = responseString.substring(0, endOfHeaders).split('\r\n');
        headersRaw.shift(); // Eliminar la línea de estado HTTP
        headersRaw.forEach(header => {
          const [key, value] = header.split(': ');
          responseHeaders[key.toLowerCase()] = value;
        });
        const statusLine = responseString.substring(0, endOfHeaders).split('\r\n')[0].split(' ');
        statusCode = parseInt(statusLine[1]);
        statusMessage = statusLine.slice(2).join(' ');
        responseData = responseData.slice(endOfHeaders + 4);
      }

      if (statusCode == 404) {
        responseData = "";
      }
      
      const response = {
        statusCode,
        statusMessage,
        headers: responseHeaders,
        body: responseData,
        method: method
      };

      handleResponse(response);
      console.log("----------------------------------------------------------------------------------------")
      console.log(response);
      console.log("----------------------------------------------------------------------------------------")
      resolve(response);
      client.destroy();
    });

    client.on('error', (err) => {
      console.error('Error:', err);
      reject(err);
      client.destroy();
    });
  });
}

// Function to handle the response based on status code
function handleResponse(response) {
  console.log("Response:\n", response, "\n");
  if (response.statusCode === 200) {
    // Check if the content type is JSON
    if (response.headers['content-type'] && response.headers['content-type'].includes('application/json')) {
      const responseBody = response.body.toString();
      fs.writeFileSync(cacheFile, responseBody);
      console.log('Resources saved to cache.');
      console.log('Cached resources:', JSON.parse(responseBody));
    } else if (response.headers['content-type'] && response.headers['content-type'].includes('image')) {
      // If the response is an image
      console.log('Received image data');
      const base64Image = response.body.toString('base64');
      response.body = base64Image;
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
    response.body = JSON.stringify(cachedResources);
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
    sendRequest,
    defaultHeaders,
};
