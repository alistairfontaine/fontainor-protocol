import { z } from 'zod';

export const registrySchema = z.array(z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  price: z.object({
    amount: z.number(),
    currency: z.string()
  }),
  editions: z.object({
    total: z.number()
  }),
  status: z.string(),
  date: z.string(),
  audioUri: z.string().url().optional().nullable(),
  coverUri: z.string().url().optional().nullable()
}));

export const validateUpload = (req, res, next) => {
  const result = registrySchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: "Invalid Registry Structure", details: result.error.format() });
  }
  next();
};
