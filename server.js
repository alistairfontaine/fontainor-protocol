const express = require('express');
const cors = require('cors');
const { uploadData } = require('./irysStorage');
const app = express();

app.use(cors()); // Allows your HTML to talk to this server
app.use(express.json()); // Allows the server to read JSON

app.post('/upload', async (req, res) => {
    try {
        const { content } = req.body;
        const txId = await uploadData(content);
        res.json({ success: true, txId });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(3000, () => console.log('Fontainor Protocol API running on http://localhost:3000'));
