const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const { connectDB, disconnectDB } = require('./config/db');

// Load env vars
dotenv.config({ path: './.env' });

// Connect to database
connectDB();

const app = express();

// Body parser
app.use(express.json());

// Enable CORS
app.use(cors());

// Mount routers
app.use('/api/auth', require('./routes/auth'));

app.get('/', (req, res) => {
  res.send('API is running...');
});

const PORT = process.env.PORT || 5000;

const server = app.listen(
  PORT,
  console.log(`Server running on port ${PORT}`)
);

// Graceful shutdown
const gracefulShutdown = () => {
  server.close(() => {
    console.log('Server closed.');
    disconnectDB().then(() => {
      console.log('MongoDB disconnected.');
      process.exit(0);
    });
  });
};

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  console.log(`Error: ${err.message}`);
  gracefulShutdown();
});

// Handle termination signals
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
