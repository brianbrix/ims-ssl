import { Link } from "react-router-dom";

const quickSteps = [
  "Open Library and choose a lesson card.",
  "Use swipe left or right on mobile to move pages.",
  "Tap a Bible verse reference to open verse details.",
  "Use the bottom page controls to jump quickly.",
  "Your reading progress is saved automatically per lesson.",
];

export function HowToUsePage() {
  return (
    <section className="howto-page" aria-labelledby="howto-title">
      <div className="howto-hero">
        <h2 id="howto-title">How To Use This Reader</h2>
        <p>
          This guide helps you read lessons smoothly on desktop and mobile.
        </p>
      </div>

      <div className="howto-grid">
        <article className="howto-card">
          <h3>Quick Start</h3>
          <ol>
            {quickSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </article>

        <article className="howto-card">
          <h3>How To Use Library</h3>
          <ol>
            <li>Open Library from the top menu.</li>
            <li>Use Sort by year to switch between Latest first and Oldest first.</li>
            <li>Scroll through lesson cards and tap a lesson cover/title to open it.</li>
            <li>Each card shows year/quarter and upload date for quick identification.</li>
          </ol>
        </article>

        <article className="howto-card">
          <h3>Mobile Controls</h3>
          <ul>
            <li>Tap Show controls to open the toolbar.</li>
            <li>Use the Outline button to open table of contents.</li>
            <li>Bottom controls stay visible for fast page changes.</li>
            <li>Verses open in a mobile-friendly bottom panel.</li>
          </ul>
        </article>

        <article className="howto-card">
          <h3>How To Open A Verse</h3>
          <ol>
            <li>Open any lesson page.</li>
            <li>Tap or click an underlined Bible reference inside the lesson text.</li>
            <li>Read the verse in the popup panel (desktop) or bottom sheet (mobile).</li>
            <li>Change translation from the dropdown in the verse panel.</li>
          </ol>
        </article>

        <article className="howto-card">
          <h3>Reading Tools</h3>
          <ul>
            <li>Use High contrast for stronger text visibility.</li>
            <li>Use zoom controls on desktop for fine scaling.</li>
            <li>Tap verse references to switch Bible translation.</li>
          </ul>
        </article>

        <article className="howto-card">
          <h3>How To Use Notes</h3>
          <ol>
            <li>Open Notes from the top menu.</li>
            <li>Tap New note to create a fresh note.</li>
            <li>Type a title, content, tags, and optionally link the note to a lesson.</li>
            <li>Notes autosave while you type.</li>
            <li>Use Search notes to quickly find previous notes.</li>
          </ol>
        </article>

        <article className="howto-card">
          <h3>Troubleshooting</h3>
          <ul>
            <li>If a page seems slow, wait for first render and try again.</li>
            <li>If a verse fails, close and tap the reference again.</li>
            <li>If layout looks stale, refresh the browser once.</li>
          </ul>
          <p className="howto-back-link">
            <Link to="/">Back to Library</Link>
          </p>
        </article>
      </div>
    </section>
  );
}
