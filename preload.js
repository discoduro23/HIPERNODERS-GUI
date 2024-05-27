window.addEventListener('DOMContentLoaded', () => {
  const net = require('net');
  const fs = require('fs');
  let client = null;
  let isConnected = false;
  let token = null;

  document.getElementById('connectBtn').addEventListener('click', (event) => {
    event.preventDefault();
    if (isConnected) {
      log('Ya estás conectado al servidor');
      return;
    }

    client = new net.Socket();
    client.connect(3010, 'localhost', () => {
      isConnected = true;
      log('Conectado al servidor');
    });

    let responseData = '';

    client.on('data', (data) => {
      responseData += data.toString();
    
      // Check if the response is complete
      if (responseData.trim().endsWith('}')) {
        try {
          const response = JSON.parse(responseData);
  
          if (response.statusCode == 404 ) {
            log("Received response: " + response.statusMessage)
            responseData = '';
            return;
          } 

          // Ensure the response is an image
          if (response.headers && response.headers['content-type'] && response.headers['content-type'].includes('image')) {
            log('Received image response: ' + response.statusMessage);
            const imageSrc = `data:image/png;base64,${response.body}`;
            showImageModal(imageSrc);
            responseData = '';
          } else {
            log('Received response: ' + beautifyJSON(response));
            responseData = '';
          }
        } catch (err) {
          log('Error parsing JSON response: ' + err + "  |  " + responseData);
        }
      }
    });

    client.on('close', () => {
      isConnected = false;
      log('Desconectado del servidor');
      client = null;
    });

    client.on('error', (err) => {
      log('Error: ' + err.message);
      isConnected = false;
      client = null;
    });
  });
  document.getElementById('requestForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    
    if (!client || client.destroyed) {
      log('No estás conectado al servidor');
      return;
    }

    const url = document.getElementById('url').value;
    const method = document.getElementById('method').value;
    const id = document.getElementById('id').value;
    const username = document.getElementById('username').value;
    const headersString = document.getElementById('headers').value;
    let bodyString = document.getElementById('body').value;

    let headers = {};
    if (headersString) {
      const headerPairs = headersString.split(',');
      headerPairs.forEach(pair => {
        const [key, value] = pair.split(':');
        headers[key.trim()] = value.trim();
      });
    }

    if (token) {
      headers['authorization'] = token;
    }
    

    let requestUrl = url;
    if (id) {
      requestUrl += `?id=${id}`;
    } else if (username) {
      requestUrl += `${username}`;
    }

    if ((method === 'POST' || method === 'PUT') && !bodyString.trim()) {
      bodyString = JSON.stringify({ nombre: "car", provincias: [] });
      log('entro');
    } else {
      try {
        JSON.parse(bodyString);
        log('intentando');
      } catch (e) {
        bodyString = JSON.stringify({ nombre: "car", provincias: [] });
        log('fffff');
      }
    }

    const message = JSON.stringify({
      url: requestUrl,
      method,
      headers,
      body: bodyString
    });

    console.log('Enviando mensaje:', message);
    client.write(message);
    log('Mensaje enviado: ' + message);
  });
  // Show/Hide fields
  document.getElementById('method').addEventListener('change', handleFieldVisibility);
  document.getElementById('url').addEventListener('input', handleFieldVisibility);

  function handleFieldVisibility() {
    const methodSelect = document.getElementById('method');
    const method = methodSelect.value;
    const url = document.getElementById('url').value;
    const idField = document.getElementById('idField');
    const usernameField = document.getElementById('usernameField');
    const bodyField = document.getElementById('bodyField');

    if (url.includes('loginflow')) {
      methodSelect.querySelector('option[value="POST"]').disabled = true;

      if (method === 'DELETE') {
        idField.classList.add('hidden');
        usernameField.classList.remove('hidden');
        bodyField.classList.add('hidden');
      } else if (method === 'PUT') {
        idField.classList.add('hidden');
        bodyField.classList.remove('hidden');
        usernameField.classList.remove('hidden');
      } else {
        usernameField.classList.add('hidden');
        idField.classList.add('hidden');
        bodyField.classList.add('hidden');
      }
    } else {
      methodSelect.querySelector('option[value="POST"]').disabled = false;
      usernameField.classList.add('hidden');

      if (method === 'GET') {
        idField.classList.add('hidden');
        bodyField.classList.add('hidden');
      } else if (method === 'DELETE') {
        idField.classList.remove('hidden');
        bodyField.classList.add('hidden');
      } else if (method === 'POST') {
        idField.classList.add('hidden');
        bodyField.classList.remove('hidden');
      } else if (method === 'PUT') {
        idField.classList.remove('hidden');
        bodyField.classList.remove('hidden');
      } else {
        idField.classList.add('hidden');
        bodyField.classList.add('hidden');
      }
    }

    if (url.includes('images')) {
      methodSelect.querySelector('option[value="PUT"]').disabled = true;
      methodSelect.querySelector('option[value="POST"]').disabled = true;
      idField.classList.add('hidden');
      bodyField.classList.add('hidden');
      usernameField.classList.add('hidden');
      if (method === 'DELETE') {
        idField.classList.add('hidden');
        bodyField.classList.add('hidden');
      }
    } else {
      methodSelect.querySelector('option[value="PUT"]').disabled = false;
    }
  }

  // Auto-complete if method is POST or PUT
  document.getElementById('method').addEventListener('change', (event) => {
    const method = event.target.value;
    const bodyField = document.getElementById('body');
    if ((method === 'POST' || method === 'PUT') && !bodyField.value.trim()) {
      bodyField.value = JSON.stringify({ nombre: "car", provincias: [] }, null, 2);
    }
  });

  document.getElementById('login').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!client || client.destroyed) {
      log('No estás conectado al servidor');
      return;
    }
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const message = JSON.stringify({
      url: 'http://176.31.196.25:3008/loginflow/login',
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    console.log('Enviando mensaje:', message);
    client.write(message);

    client.once('data', (data) => {
      const response = JSON.parse(data.toString());
      if (response.body) {
        const newResponse = JSON.parse(response.body);

        if (newResponse.token) {
          token = newResponse.token;
          document.getElementById('loginForm').classList.add('hidden');
          document.getElementById('requestContainer').classList.remove('hidden');
          document.getElementById('logoutBtn').classList.remove('hidden');
          document.getElementById('sendBtn').classList.remove('hidden');
          log('Login successful');
        } else {
          log('Login failed');
        }
      }
    });
  });

  document.getElementById('register').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!client || client.destroyed) {
      log('No estás conectado al servidor');
      return;
    }
    const username = document.getElementById('register-username').value;
    const password = document.getElementById('register-password').value;
    const message = JSON.stringify({
      url: 'http://176.31.196.25:3008/loginflow/register',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    console.log('Enviando mensaje:', message);
    client.write(message);

    client.once('data', (data) => {
      const response = data.toString();
      log('Register response: ' + beautifyJSON(response));
      document.getElementById('registerForm').classList.add('hidden');
      document.getElementById('loginForm').classList.remove('hidden');
    });
  });

  document.getElementById('showRegister').addEventListener('click', () => {
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('registerForm').classList.remove('hidden');
  });

  document.getElementById('showLogin').addEventListener('click', () => {
    document.getElementById('registerForm').classList.add('hidden');
    document.getElementById('loginForm').classList.remove('hidden');
  });

  document.getElementById('logoutBtn').addEventListener('click', () => {
    token = null;
    document.getElementById('requestContainer').classList.add('hidden');
    document.getElementById('logoutBtn').classList.add('hidden');
    document.getElementById('sendBtn').classList.add('hidden');
    document.getElementById('loginForm').classList.remove('hidden');
    clearLog();
    log('Logout successful');
  });

  //init show fields default method
  document.getElementById('method').dispatchEvent(new Event('change'));

  function log(message) {
    const logElem = document.getElementById('log');
    const logMessageElem = document.createElement('div');
    logMessageElem.classList.add('log-message');
    logMessageElem.textContent = message;
    logElem.appendChild(logMessageElem);
    logElem.scrollTop = logElem.scrollHeight;
  }

  function clearLog() {
    const logElem = document.getElementById('log');
    logElem.innerHTML = '';
  }

  function beautifyJSON(input) {
    try {
      return JSON.stringify(input, null, 2);
    } catch (e) {
      return input;
    }
  }

  function showImageModal(imageSrc) {
    const modal = document.getElementById('imageModal');
    const modalImage = document.getElementById('modalImage');

    modal.style.display = 'block';
    modalImage.src = imageSrc;

    const span = document.getElementsByClassName('close')[0];
    span.onclick = function () {
      modal.style.display = 'none';
    };

    window.onclick = function (event) {
      if (event.target === modal) {
        modal.style.display = 'none';
      }
    };
  }

});
