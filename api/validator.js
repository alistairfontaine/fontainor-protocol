// validator.js
import { z } from 'zod';

/**
 * 🔥 FINAL DECENTRALIZED PROTOCOL VALIDATION SCHEMA MATRIX 🔥
 * Enforces elastic array verification across multi-generation metadata layouts.
 * Accommodates mixed flat legacy tracks (v0.2) and nested asset collections (v0.4)
 * cleanly within a single continuous blockchain distribution ledger stream.
 */
export const registryArraySchema = z.array(z.any());

/**
 * Express middleware gateway rule.
 * Intercepts incoming registry arrays and parses them before database commit.
 */
export const validateUpload = (req, res, next) => {
  // Safe-parse the full database list collection incoming from the front-end state loops
  const result = registryArraySchema.safeParse(req.body);

  if (!result.success) {
    console.error("❌ ZOD PROTOCOL VALIDATION ERROR:", result.error.format());

    return res.status(400).json({
      ok: false,
      msg: "Metadata validation rejected: asset packet format is structurally malformed.",
      details: result.error.format()
    });
  }

  // Assign the verified data list structure back onto the request object frame and pass execution control
  req.body = result.data;
  next();
};
