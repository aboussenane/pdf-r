import React, { useState, useEffect } from "react";

function App() {
  const [pageAmount, setPageAmount] = useState(1);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [calculating, setCalculating] = useState(false);
  useEffect(() => {
    const messageListener = (message: any) => {
      if (message.action === "calculating") {
        setCalculating(true);
      }
      if (message.action === "captureProgress") {
        setLoading(true);
        setProgress(message.progress);
        
        // Reset loading when capture is complete
        if (message.progress.current === message.progress.total) {
          setTimeout(() => setLoading(false), 1000);
        }
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);
    return () => chrome.runtime.onMessage.removeListener(messageListener);
  }, []);

  const captureScreenshot = () => {
    chrome.runtime.sendMessage({ 
      action: "captureTab",
      pageAmount: pageAmount
    });
  };

  return (
    <div className="container">
      <h1>Webpage to PDF</h1>
      {calculating && (
        <p>Capturing...</p>
      )}
      {loading && (
        <div className="progress-container">
          <div className="progress-bar-container">
            <div 
              className="progress-bar"
              style={{ 
                width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%`
              }}
            />
          </div>
          <p className="progress-text">
            {progress.current} / {progress.total} pages captured
          </p>
        </div>
      )}
      
      <button 
        onClick={captureScreenshot}
        disabled={loading}
        
      >
        {loading ? 'Capturing...' : 'Capture'}
      </button>
    </div>
  );
}

export default App;
