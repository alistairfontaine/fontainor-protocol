import app from './api/index.js';
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Fontainor API running on port ${PORT}`);
});
