const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

// Webhook endpoint
app.post('/webhook', (req, res) => {
  const { event, data } = req.body;
  console.debug(`Received webhook: ${event}`);
  console.debug('Data:', data);
  res.sendStatus(200);
});

// Start the server
const PORT = 3001;
app.listen(PORT, () => {
  console.debug(`Webhook server listening on port ${PORT}`);
});