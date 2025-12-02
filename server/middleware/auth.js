const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
  try {
    // Check for token in cookies first, then headers (including x-auth-token from localStorage)
    const token = req.cookies.token || 
                  req.headers.authorization?.replace('Bearer ', '') || 
                  req.headers['x-auth-token'];
    
    if (!token) {
      return res.status(401).json({ 
        error: 'Authentication required',
        message: 'Please login to access this resource'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    // Get user with pesuPassword for scraping (don't exclude it)
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Attach user to request (includes pesuPassword for scraper)
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token', message: 'Please login again' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', message: 'Please login again' });
    }
    res.status(401).json({ error: 'Authentication failed', message: error.message });
  }
};

module.exports = auth;

