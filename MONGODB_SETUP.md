# MongoDB Setup Guide for PESUConnect

This guide will help you set up MongoDB for the PESUConnect application. You have two options:

## Option 1: MongoDB Atlas (Cloud - Recommended for Beginners)

MongoDB Atlas is a free cloud-hosted MongoDB service. It's the easiest way to get started.

### Steps:

1. **Create a MongoDB Atlas Account**
   - Go to [https://www.mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas)
   - Sign up for a free account

2. **Create a Cluster**
   - Click "Build a Database"
   - Choose the FREE tier (M0)
   - Select a cloud provider and region (choose closest to you)
   - Click "Create"

3. **Create a Database User**
   - Go to "Database Access" in the left sidebar
   - Click "Add New Database User"
   - Choose "Password" authentication
   - Enter a username and password (save these!)
   - Set privileges to "Atlas admin" or "Read and write to any database"
   - Click "Add User"

4. **Whitelist Your IP Address**
   - Go to "Network Access" in the left sidebar
   - Click "Add IP Address"
   - Click "Allow Access from Anywhere" (for development) or add your specific IP
   - Click "Confirm"

5. **Get Your Connection String**
   - Go to "Database" in the left sidebar
   - Click "Connect" on your cluster
   - Choose "Connect your application"
   - Copy the connection string (it looks like: `mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`)

6. **Update Your .env File**
   - In the `server` folder, create a `.env` file (copy from `.env.example`)
   - Replace the `MONGODB_URI` with your connection string:
   ```env
   MONGODB_URI=mongodb+srv://yourusername:yourpassword@cluster0.xxxxx.mongodb.net/pesuconnect?retryWrites=true&w=majority
   ```
   - Replace `yourusername` and `yourpassword` with your database user credentials
   - The `pesuconnect` part is the database name (you can change it)

## Option 2: Local MongoDB Installation

If you prefer to run MongoDB locally on your computer:

### Windows:

1. **Download MongoDB**
   - Go to [https://www.mongodb.com/try/download/community](https://www.mongodb.com/try/download/community)
   - Select Windows and download the MSI installer

2. **Install MongoDB**
   - Run the installer
   - Choose "Complete" installation
   - Install MongoDB as a Windows Service (recommended)
   - Install MongoDB Compass (GUI tool - optional but helpful)

3. **Verify Installation**
   - MongoDB should start automatically as a service
   - You can verify by opening Command Prompt and running:
     ```bash
     mongod --version
     ```

4. **Update Your .env File**
   - In the `server` folder, create a `.env` file
   - Use the default connection string:
   ```env
   MONGODB_URI=mongodb://localhost:27017/pesuconnect
   ```

### macOS:

1. **Install using Homebrew**
   ```bash
   brew tap mongodb/brew
   brew install mongodb-community
   ```

2. **Start MongoDB**
   ```bash
   brew services start mongodb-community
   ```

3. **Update Your .env File**
   ```env
   MONGODB_URI=mongodb://localhost:27017/pesuconnect
   ```

### Linux (Ubuntu/Debian):

1. **Install MongoDB**
   ```bash
   sudo apt-get update
   sudo apt-get install -y mongodb
   ```

2. **Start MongoDB**
   ```bash
   sudo systemctl start mongodb
   sudo systemctl enable mongodb
   ```

3. **Update Your .env File**
   ```env
   MONGODB_URI=mongodb://localhost:27017/pesuconnect
   ```

## Setting Up Your .env File

1. **Navigate to the server folder**
   ```bash
   cd server
   ```

2. **Create .env file**
   - Copy the example file:
     ```bash
     # Windows
     copy .env.example .env
     
     # macOS/Linux
     cp .env.example .env
     ```

3. **Edit .env file** with your MongoDB connection string:
   ```env
   PORT=5000
   MONGODB_URI=your-connection-string-here
   JWT_SECRET=your-random-secret-key-here-make-it-long-and-random
   NODE_ENV=development
   ```

## Testing the Connection

1. **Start your server**
   ```bash
   cd server
   npm run dev
   ```

2. **Look for this message in the console:**
   ```
   Connected to MongoDB
   Server running on port 5000
   ```

3. **If you see an error**, check:
   - MongoDB is running (if using local)
   - Connection string is correct
   - IP address is whitelisted (if using Atlas)
   - Username and password are correct

## Using MongoDB Compass (Optional GUI Tool)

MongoDB Compass is a visual tool to view and manage your database:

1. **Download**: [https://www.mongodb.com/try/download/compass](https://www.mongodb.com/try/download/compass)
2. **Connect**: Use your connection string to connect
3. **Browse**: View collections, documents, and run queries

## Troubleshooting

### Connection Timeout
- Check if MongoDB service is running (local)
- Verify IP whitelist (Atlas)
- Check firewall settings

### Authentication Failed
- Verify username and password in connection string
- Ensure database user has proper permissions

### Port Already in Use
- Change PORT in .env file
- Or stop the process using port 5000

## Quick Start (Recommended: MongoDB Atlas)

1. Sign up at [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas)
2. Create free cluster
3. Get connection string
4. Update `server/.env` with connection string
5. Run `npm run dev` in server folder
6. You should see "Connected to MongoDB"!

