const request = require('supertest');
const fs = require('fs');
const path = require('path');
const server = require('../server.js');

const BASE_URL = 'http://localhost:3008'; // Cambia esto por la URL de tu servidor

const dataDir = path.join(__dirname, '../data');
const imagesDir = path.join(__dirname, '../images');
const backupDir = path.join(__dirname, '../data/backup');

// Función para crear una copia de seguridad de los archivos JSON
function backupJsonFiles() {
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir);
  }

  fs.readdirSync(dataDir).forEach(file => {
    if (file.endsWith('.json')) {
      fs.copyFileSync(path.join(dataDir, file), path.join(backupDir, file));
    }
  });
}

// Función para restaurar los archivos JSON desde la copia de seguridad
function restoreJsonFiles() {
  fs.readdirSync(backupDir).forEach(file => {
    fs.copyFileSync(path.join(backupDir, file), path.join(dataDir, file));
  });
}

// Crear copias de seguridad antes de los tests
beforeAll((done) => {
  backupJsonFiles();
  done();
});

// Restaurar los archivos originales después de los tests
afterAll((done) => {
  //erase test image if exists
  if (fs.existsSync(path.join(imagesDir, 'test.png'))) {
    fs.unlinkSync(path.join(imagesDir, 'test.png'));
  }
  restoreJsonFiles();
  server.stop(done); // Ensure the server is stopped after tests
});

// Tests
describe('Server Endpoints', () => {
  describe('API key', () => {

    it('should return 403 forbidden for no key', (done) => {
      request(BASE_URL)
        .get('/resources')
        .expect(403, done);
    });

    it('should return 200 for valid key', (done) => {
      request(BASE_URL)
      .get('/')
      .set('X-API-Key', 'hiperKEY_24')
      .expect('Content-Type', 'text/html')
      .expect(200)
      .end(done);
    });

    it('should return 403 for invalid key', (done) => {
      request(BASE_URL)
        .get('/resources')
        .set('X-API-Key', 'invalid-api-key')
        .expect(403, done);
    });
  });

  describe('GET /resources', () => {
    it('should return resources', (done) => {
      request(BASE_URL)
        .get('/resources')
        .set('X-API-Key', 'hiperKEY_24')
        .expect('Content-Type', /json/)
        .expect(200)
        .expect((res) => {
          expect(res.body).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ lastModified: expect.any(String) }),
            ])
          );
        })
        .end(done);
    });
    
  });

  describe('POST /resources', () => {
    it('should add a new resource', (done) => {
      request(BASE_URL)
        .post('/resources')
        .set('X-API-Key', 'hiperKEY_24')
        .send({ nombre: 'New Resource', provincias: ['Province1'] })
        .expect(201)
        .expect((res) => {
          expect(res.text).toContain('Resource added successfully with ID');
        })
        .end(done);
    });

    it('should return 400 for empty body', (done) => {
      request(BASE_URL)
        .post('/resources')
        .set('X-API-Key', 'hiperKEY_24')
        .send('')
        .expect(400, done);
    });
  });

  describe('PUT /resources', () => {
    it('should update an existing resource', (done) => {
      request(BASE_URL)
        .put('/resources?id=1')
        .set('X-API-Key', 'hiperKEY_24')
        .send({ nombre: 'Updated Resource', provincias: ['Updated Province'] })
        .expect(200)
        .expect((res) => {
          expect(res.text).toBe('Resource updated successfully');
        })
        .end(done);
    });

    it('should return 404 for non-existent resource', (done) => {
      request(BASE_URL)
        .put('/resources?id=999')
        .set('X-API-Key', 'hiperKEY_24')
        .send({ nombre: 'Non-existent Resource' })
        .expect(404, done);
    });
  });

  describe('DELETE /resources', () => {
    it('should delete an existing resource', (done) => {
      request(BASE_URL)
        .delete('/resources?id=1')
        .set('X-API-Key', 'hiperKEY_24')
        .expect(200)
        .expect((res) => {
          expect(res.text).toBe('Resource deleted successfully');
        })
        .end(done);
    });

    it('should return 404 for non-existent resource', (done) => {
      request(BASE_URL)
        .delete('/resources?id=999')
        .set('X-API-Key', 'hiperKEY_24')
        .expect(404, done);
    });
  });

  describe('POST /images', () => {
    it('should upload an image', (done) => {
      request(BASE_URL)
        .post('/images')
        .set('X-API-Key', 'hiperKEY_24')
        .set('Content-Type', 'multipart/form-data; boundary=boundary')
        .send('--boundary\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n<binary data>\r\n--boundary--')
        .expect(201)
        .expect((res) => {
          expect(res.text).toBe('Image saved as test.png');
        })
        .end(done);
    });

    it('should return 400 for invalid file upload', (done) => {
      request(BASE_URL)
        .post('/images')
        .set('X-API-Key', 'hiperKEY_24')
        .set('Content-Type', 'multipart/form-data; boundary=boundary')
        .send('--boundary\r\nContent-Disposition: form-data; name="file"\r\n\r\n<binary data>\r\n--boundary--')
        .expect(400, done);
    });
  });
});