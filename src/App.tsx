import { lazy, Suspense } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { LibraryPage } from "./pages/LibraryPage";
import { UploadPage } from "./pages/UploadPage";
import imsLogo from "./assets/ims-logo.png";
import "./App.css";

const LessonViewerPage = lazy(() => import("./pages/LessonViewerPage").then((module) => ({
  default: module.LessonViewerPage,
})));
const HowToUsePage = lazy(() => import("./pages/HowToUsePage").then((module) => ({
  default: module.HowToUsePage,
})));
const NotesPage = lazy(() => import("./pages/NotesPage").then((module) => ({
  default: module.NotesPage,
})));

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
          <NavLink to="/notes">Notes</NavLink>
          <NavLink to="/how-to-use">How to use</NavLink>
          <NavLink to="/upload">Upload</NavLink>
        </nav>
      </header>

      <div className="app-body">
        <Routes>
          <Route path="/" element={<LibraryPage />} />
          <Route
            path="/notes"
            element={(
              <Suspense fallback={<p className="page-message">Loading notes…</p>}>
                <NotesPage />
              </Suspense>
            )}
          />
          <Route
            path="/how-to-use"
            element={(
              <Suspense fallback={<p className="page-message">Loading help…</p>}>
                <HowToUsePage />
              </Suspense>
            )}
          />
          <Route path="/upload" element={<UploadPage />} />
          <Route
            path="/lesson/:id"
            element={(
              <Suspense fallback={<p className="page-message">Loading lesson viewer…</p>}>
                <LessonViewerPage />
              </Suspense>
            )}
          />
        </Routes>
      </div>
    </div>
  );
}

export default App;
