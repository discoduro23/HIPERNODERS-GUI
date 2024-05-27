const readline = require('readline');
const net = require('net');
const { sendRequest, defaultHeaders } = require('./modules/clientlib');

// Function to get input from the user
function getInput(prompt) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => rl.question(prompt, (answer) => {
    rl.close();
    resolve(answer);
  }));
}

// Function to handle manual input
async function manualRequest(callback) {
  let url = await getInput('Enter URL: ');
  if (!url) {
    url = 'http://176.31.196.25:3009/resources';
  }
  let method;
  do {
    method = await getInput('Enter HTTP Method (GET, POST, PUT, DELETE): ');
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) {
      console.log('Invalid method. Please enter GET, POST, PUT, or DELETE.');
    }
  } while (!['GET', 'POST', 'PUT', 'DELETE'].includes(method));

  const headerString = await getInput('Enter headers (key:value, separate multiple with commas): ');
  const bodyString = await getInput('Enter body (JSON format): ');

  let headers = {
    'x-api-key': 'hiperKEY_24',
  };

  if (headerString) {
    const headerPairs = headerString.split(',');
    headerPairs.forEach(pair => {
      const [key, value] = pair.split(':');
      headers[key.trim()] = value.trim();
    });
  }

  let body = null;
  try {
    body = JSON.parse(bodyString);
  } catch (e) {
    console.log('Invalid JSON body, sending as raw string.');
    body = bodyString;
  }

  try {
    const response = await sendRequest(url, method, headers, body);
    console.log(response);
  } catch (err) {
    console.error('Error:', err);
  }

  if (callback) callback();
}

async function handleRequest(url, method, headers, body, callback) {
  let cacheHeaders = {};

  const headersdefault = { ...defaultHeaders, ...cacheHeaders,...headers};

  try {

    let bodyString = body;
    if (typeof body !== 'string') {
      bodyString = JSON.stringify(body);
    }

    const response = await sendRequest(url, method, headersdefault, JSON.parse(bodyString));
    if (callback) callback(response); // Pass the response to the callback
  } catch (err) {
    console.error('Error:', err);
    if (callback) callback('Error: ' + err.message); // Pass the error message to the callback
  }
}

// Function to show menu and handle choices
async function showMenu() {
  console.log('Menu:');
  console.log('1) Enter the function parameters manually');
  console.log('2) Make the GET function (predefined before)');
  const choice = await getInput('Choose an option: ');

  switch (choice) {
    case '1':
      await manualRequest(showMenu);
      break;
    case '2':
      handleRequest('http://176.31.196.25:3008/resources', 'GET', defaultHeaders, null, showMenu);
      break;
    default:
      console.log('Invalid choice. Exiting.');
      return; // Exit if invalid choice
  }
}

const clientsrv = net.createServer((socket) => {
  console.log('HTML Client connected');
 
  socket.on('data', (data) => {
    console.log(`Received from HTML: ${data}`);
    const requestData = JSON.parse(data.toString());

    const { url, method, headers, body } = requestData;
    handleRequest(url, method, headers, body, (response) => {
      if (response) {
        socket.write(JSON.stringify(response));
      } else {
        socket.write('No response received.');
      }
    });
  });

  socket.on('error', (err) => {
    console.log('ERROR', `Socket error: ${err.message}`);
  });

  socket.on('end', () => {
    console.log('HTML Client disconnected');
  });
})



clientsrv.listen(3010, () => {
  console.log('clientsrv listening on port 3010');
});

// // Start the menu
// showMenu();

module.exports = {
  handleRequest,
  manualRequest,
};
