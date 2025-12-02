import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const Chat = ({ user, section, compact = false }) => {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    fetchMessages();
  }, [section]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const fetchMessages = async () => {
    try {
      const res = await axios.get(`/api/chat/${section}`);
      setMessages(res.data);
    } catch (error) {
      console.error('Failed to fetch messages:', error);
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || loading) return;

    setLoading(true);
    try {
      const res = await axios.post(`/api/chat/${section}`, {
        text: newMessage
      });
      setMessages([...messages, res.data]);
      setNewMessage('');
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setLoading(false);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const chatHeight = compact ? 180 : 220;

  return (
    <div className="card" style={{ marginTop: '12px' }} data-key="chat">
      <div className="title">Class Chat — {section}</div>
      <div className="sub">Group chat for the selected section.</div>
      <div className="chat" style={compact ? { height: chatHeight } : undefined}>
        <div className="messages" id="messages">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`msg ${msg.senderSrn === user?.srn || msg.sender === user?.srn ? 'me' : ''}`}
            >
              {msg.sender !== 'system' && (
                <div className="mini" style={{ marginBottom: '4px' }}>
                  {msg.senderSrn === user?.srn || msg.sender === user?.srn 
                    ? 'You' 
                    : (msg.senderName || msg.senderSrn || msg.sender)}
                </div>
              )}
              {msg.text}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
        <form className="chat-input" onSubmit={sendMessage}>
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid rgba(0,0,0,0.06)' }}
          />
          <button type="submit" className="btn ghost" disabled={loading}>
            {loading ? 'Sending...' : 'Send'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Chat;

