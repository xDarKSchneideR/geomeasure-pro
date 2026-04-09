import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import authRoutes from './auth.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware - aumentar límite a 10MB para proyectos con imágenes
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// API Routes
app.use('/api/auth', authRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});