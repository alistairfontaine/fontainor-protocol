import express from 'express';
import { validateUpload } from './validator.js'; // Bringing back the security layer
const app = express();

app.use(express.json());

// We add validateUpload back into the route
app.post('/upload', validateUpload, (req, res) => {
    console.log("Passed validation. Body data:", req.body);
    return res.status(200).json({ message: "Upload validated and received" });
});

app.listen(3000, () => console.log('Fontainor Protocol running on port 3000'));
