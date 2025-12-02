const express = require('express');
const auth = require('../middleware/auth');
const User = require('../models/User');
const Chat = require('../models/Chat');

const router = express.Router();

// Get messages for a section
router.get('/:section', auth, async (req, res) => {
  try {
    const { section } = req.params;
    
    // Fetch all messages for this section from database, sorted by timestamp
    let messages = await Chat.find({ section })
      .sort({ timestamp: 1 }) // Sort by timestamp ascending (oldest first)
      .lean(); // Use lean() for better performance
    
    // If no messages exist, create a welcome message
    if (messages.length === 0) {
      const welcomeMessage = new Chat({
        section,
        text: `Welcome to ${section} — use this for quick doubts & resource links.`,
        sender: 'system',
        senderSrn: null,
        senderName: null,
        timestamp: new Date()
      });
      await welcomeMessage.save();
      messages = [welcomeMessage.toObject()];
    }
    
    // Populate sender names for messages that don't have them
    const messagesWithNames = await Promise.all(messages.map(async (msg) => {
      // Convert MongoDB _id to id for frontend compatibility
      const message = {
        id: msg._id.toString(),
        text: msg.text,
        sender: msg.sender,
        senderSrn: msg.senderSrn,
        senderName: msg.senderName,
        timestamp: msg.timestamp
      };
      
      if (msg.sender === 'system' || !msg.senderSrn) {
        return message;
      }
      
      // If message already has senderName, return as is
      if (msg.senderName) {
        return message;
      }
      
      // Look up sender name from database
      try {
        const senderUser = await User.findOne({ srn: msg.senderSrn });
        if (senderUser && senderUser.name) {
          // Update the message in database with the name for future queries
          await Chat.findByIdAndUpdate(msg._id, { senderName: senderUser.name });
          message.senderName = senderUser.name;
        }
      } catch (err) {
        // Silently fail - will just show SRN
      }
      
      return message;
    }));
    
    res.json(messagesWithNames);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Send a message
router.post('/:section', auth, async (req, res) => {
  try {
    const { section } = req.params;
    const { text } = req.body;
    
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Message text is required' });
    }

    // Create and save message to database
    const message = new Chat({
      section,
      text: text.trim(),
      sender: req.user.srn, // Keep for backward compatibility
      senderSrn: req.user.srn,
      senderName: req.user.name || '', // Store name from current user
      timestamp: new Date()
    });

    await message.save();

    // Return message in format expected by frontend
    res.json({
      id: message._id.toString(),
      text: message.text,
      sender: message.sender,
      senderSrn: message.senderSrn,
      senderName: message.senderName,
      timestamp: message.timestamp
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

