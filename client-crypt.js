const readline = require('readline');
const { establishSharedSecret, sendRequest, defaultHeaders } = require('./modules/clientlib-crypto');

let secret = null; // Definir la variable global secret

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

async function manualRequest(callback) {
  let url = await getInput('Enter URL: ');
  if (!url) {
    url = 'http://176.31.196.25/resources';
  }
  if (!secret) {
    secret = await establishSharedSecret();
    console.log('Secreto compartido generado:', secret.toString('hex'));
  } else {
    console.log('Secreto a usar:', secret.toString('hex'));
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

async function handleRequest(callback) {
  if (!secret) {
    secret = await establishSharedSecret();
    console.log('Secreto compartido establecido:', secret.toString('hex'));
  } else {
    console.log('Secreto a usar:', secret.toString('hex'));
  }

  let cacheHeaders = {};
  const headers = { ...defaultHeaders, ...cacheHeaders };
  try {
    const response = await sendRequest('http://176.31.196.25/resources', 'GET', headers, null);
    console.log(response);
  } catch (err) {
    console.error('Error:', err);
  }
  if (callback) callback();
}

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
      handleRequest(showMenu);
      break;
    default:
      console.log('Invalid choice. Exiting.');
      return;
  }
}

showMenu();

module.exports = {
  handleRequest,
  manualRequest,
};
