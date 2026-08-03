import { NavLink, Route, Routes } from "react-router-dom";
import { LibraryPage } from "./pages/LibraryPage";
import { UploadPage } from "./pages/UploadPage";
import { LessonViewerPage } from "./pages/LessonViewerPage";
import imsLogo from "./assets/ims-logo.png";
import "./App.css";

function App() {
  return (
    <div className="app">
      <header className="app-header">
        <div className="brand-block" aria-label="IMS branding">
          <img src={imsLogo} alt="IMS SDA official logo" className="brand-logo" />
          <div className="brand-text">
            <h1>Sabbath School Lessons Reader</h1>
          </div>
        </div>
        <nav className="main-nav">
          <NavLink to="/" end>
            Library
          </NavLink>
          <NavLink to="/upload">Upload</NavLink>
        </nav>
      </header>

      <div className="app-body">
        <Routes>
          <Route path="/" element={<LibraryPage />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/lesson/:id" element={<LessonViewerPage />} />
        </Routes>
      </div>
    </div>
  );
}

export default App;
