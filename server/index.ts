import express from 'express';
import cors from 'cors';

import authRoutes from './auth.js';

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware - aumentar límite a 50MB para proyectos con imágenes
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// API Routes
app.use('/api/auth', authRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});