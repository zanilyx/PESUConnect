# PESUConnect

A smarter, more intuitive interface for PESU Academy that provides students with easy access to attendance, results, timetable, course resources, and section-based chat functionality.

> **Status:** This project is **actively in development**. APIs, data flows, and UI may change frequently.

## 🎯 Features

- **📊 Dashboard Overview**: Quick access to attendance, timetable, and recent resources
- **📈 Attendance Tracking**: View attendance by semester with detailed statistics
- **📚 Course Resources**: Browse and download course materials (PDFs, slides) organized by semester, subject, unit, and class
- **📝 Academic Results**: View results by semester with GPA calculations
- **📅 Timetable**: View your class schedule in a clean, organized format
- **💬 Section Chat**: Group chat functionality for your class section
- **🎨 Customizable Themes**: Multiple gradient themes and dark mode support
- **⚡ Smart Caching**: Fast loading with intelligent background data synchronization

## 🛠️ Tech Stack

### Frontend
- **React** 18.2.0 - UI framework
- **React Router** 6.20.1 - Client-side routing
- **Axios** 1.6.2 - HTTP client
- **CSS3** - Custom styling with theme support

### Backend
- **Node.js** - Runtime environment
- **Express** 4.18.2 - Web framework
- **MongoDB** with **Mongoose** 8.0.3 - Database and ODM
- **JWT** (jsonwebtoken) - Authentication
- **bcryptjs** - Password hashing
- **Cheerio** - HTML parsing for web scraping
- **Axios with Cookie Jar** - Session management for scraping

## 📋 Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v14 or higher) - [Download](https://nodejs.org/)
- **npm** (comes with Node.js) or **yarn**
- **MongoDB** (local installation) or **MongoDB Atlas** account - [Setup Guide](./MONGODB_SETUP.md)

## 🚀 Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd PESUConnect
   ```

2. **Install dependencies**
   
   Install all dependencies (root, server, and client):
   ```bash
   npm run install-all
   ```
   
   Or install them separately:
   ```bash
   # Root dependencies
   npm install
   
   # Server dependencies
   cd server
   npm install
   cd ..
   
   # Client dependencies
   cd client
   npm install
   cd ..
   ```

3. **Set up environment variables**
   
   Create a `.env` file in the `server` directory:
   ```bash
   cd server
   cp .env.example .env  # If .env.example exists
   ```
   
   Edit `server/.env` with your configuration:
   ```env
   PORT=5000
   MONGODB_URI=your-mongodb-connection-string
   JWT_SECRET=your-random-secret-key-here-make-it-long-and-random
   NODE_ENV=development
   ```
   
   For MongoDB setup instructions, see [MONGODB_SETUP.md](./MONGODB_SETUP.md)

## 🏃 Running the Application

### Development Mode (Recommended)

Run both server and client concurrently:
```bash
npm run dev
```

This will start:
- **Backend server** on `http://localhost:5000`
- **Frontend client** on `http://localhost:3000`

### Run Separately

**Backend only:**
```bash
npm run server
# or
cd server
npm run dev
```

**Frontend only:**
```bash
npm run client
# or
cd client
npm start
```

### Production Build

**Build the frontend:**
```bash
cd client
npm run build
```

**Start production server:**
```bash
cd server
npm start
```

## 📁 Project Structure

```
PESUConnect/
├── client/                 # React frontend application
│   ├── public/            # Static assets
│   ├── src/
│   │   ├── components/    # React components
│   │   │   ├── Attendance.js
│   │   │   ├── Chat.js
│   │   │   ├── Dashboard.js
│   │   │   ├── Login.js
│   │   │   ├── Overview.js
│   │   │   ├── Resources.js
│   │   │   ├── Results.js
│   │   │   ├── Settings.js
│   │   │   ├── Sidebar.js
│   │   │   └── Timetable.js
│   │   ├── hooks/         # Custom React hooks
│   │   ├── utils/         # Utility functions
│   │   ├── App.js         # Main app component
│   │   └── index.js       # Entry point
│   └── package.json
├── server/                # Express backend application
│   ├── middleware/        # Express middleware
│   │   └── auth.js        # JWT authentication
│   ├── models/            # Mongoose schemas
│   │   ├── Attendance.js
│   │   ├── Chat.js
│   │   ├── Result.js
│   │   ├── Timetable.js
│   │   └── User.js
│   ├── routes/            # API routes
│   │   ├── attendance.js
│   │   ├── auth.js
│   │   ├── chat.js
│   │   ├── resources.js
│   │   ├── results.js
│   │   └── timetable.js
│   ├── services/          # Business logic
│   │   └── pesuScraper.js # Web scraping service
│   ├── index.js           # Server entry point
│   └── package.json
├── package.json           # Root package.json
├── MONGODB_SETUP.md      # MongoDB setup guide
├── FILE_EXPLANATIONS.txt # Detailed file documentation
└── README.md             # This file
```

## 🔌 API Endpoints

### Authentication
- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/logout` - Logout user
- `GET /api/auth/me` - Get current user profile
- `POST /api/auth/refresh` - Refresh user data

### Attendance
- `GET /api/attendance/html/:semesterId` - Get attendance for a semester
- `POST /api/attendance/sync` - Sync attendance data

### Results
- `GET /api/results/:semester` - Get results for a semester
- `POST /api/results/sync` - Sync results data

### Resources
- `GET /api/resources/semesters/cached` - Get cached semesters
- `GET /api/resources/html/semesters` - Fetch semesters from PESU
- `POST /api/resources/subjects` - Get subjects for a semester
- `GET /api/resources/units/:courseId` - Get units for a subject
- `GET /api/resources/classes/:unitId` - Get classes for a unit
- `POST /api/resources/preview` - Get document IDs for preview
- `GET /api/resources/download/:docId` - Download a resource file

### Timetable
- `GET /api/timetable` - Get user timetable
- `POST /api/timetable/sync` - Sync timetable data

### Chat
- `GET /api/chat/:section` - Get messages for a section
- `POST /api/chat/:section` - Send a message to a section

## 🔐 Authentication

The application uses JWT (JSON Web Tokens) for authentication. Tokens are stored in:
- **HTTP-only cookies** (primary method)
- **localStorage** (fallback for cookie-blocked environments)

Protected routes require a valid JWT token in:
- Cookies (automatic)
- `Authorization` header: `Bearer <token>`
- `x-auth-token` header

## 💾 Caching Strategy

PESUConnect implements intelligent caching to provide fast user experience:

- **Immediate Cache Return**: All routes return cached data instantly if available
- **Background Sync**: Fresh data is fetched in the background and cache is updated if data differs
- **Cache Validation**:
  - **7-day rule**: Results and timetable only refresh if cache is older than 7 days
  - **Session-based**: Subjects cache is validated per login session
- **Data Comparison**: Prevents unnecessary database writes when data hasn't changed

## 🎨 Theming

The application supports multiple themes:
- **Light/Dark Mode**: Toggle between light and dark themes
- **Gradient Themes**: Choose from various gradient color schemes (daybreak, sunset, ocean, forest, etc.)
- **Persistent Settings**: Theme preferences are saved in localStorage

## 🐛 Troubleshooting

### MongoDB Connection Issues
- Verify MongoDB is running (if using local installation)
- Check `MONGODB_URI` in `server/.env`
- Ensure IP is whitelisted (if using MongoDB Atlas)
- See [MONGODB_SETUP.md](./MONGODB_SETUP.md) for detailed setup

### Port Already in Use
- Change `PORT` in `server/.env`
- Or stop the process using the port

### Authentication Errors
- Clear browser cookies and localStorage
- Verify `JWT_SECRET` is set in `server/.env`
- Check token expiration

### Scraping Issues
- Verify PESU Academy credentials are correct
- Check if PESU Academy website structure has changed
- Review server logs for detailed error messages

## 📝 Additional Documentation

- **File Explanations**: See [FILE_EXPLANATIONS.txt](./FILE_EXPLANATIONS.txt) for detailed documentation of each file
- **MongoDB Setup**: See [MONGODB_SETUP.md](./MONGODB_SETUP.md) for database setup instructions

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## ⚠️ Disclaimer

This application is for educational purposes only. It interfaces with PESU Academy's portal and should be used responsibly. Users are responsible for complying with PESU Academy's terms of service.

## 📄 License

This project is licensed under the MIT License.

## 👥 Authors

- **zanilyx** - [@zanilyx](https://github.com/zanilyx) - Lead Developer & Backend Integration
- **apatelpiyush** - [@apatelpiyush](https://github.com/apatelpiyush) - UI/UX Designer & Frontend Developer

Created for PESU students to enhance their academic portal experience.

---

**Note**: This application requires valid PESU Academy credentials to function. All data is fetched from the official PESU Academy portal.

