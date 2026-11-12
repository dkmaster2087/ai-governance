import { useEffect } from 'react';
import { Navigate, Routes, Route, useLocation } from 'react-router-dom';
import { Navbar } from './components/layout/Navbar';
import { Footer } from './components/layout/Footer';
import { HomePage } from './pages/HomePage';
import { GatewayPage } from './pages/GatewayPage';
import { HowItWorksPage } from './pages/HowItWorksPage';
import { AssessmentPage } from './pages/AssessmentPage';
import { PricingPage } from './pages/PricingPage';
import { DeploymentPage } from './pages/DeploymentPage';
import { SecurityPage } from './pages/SecurityPage';
import { AboutPage } from './pages/AboutPage';
import { ContactPage } from './pages/ContactPage';
import { CompliancePage } from './pages/CompliancePage';

export default function App() {
  const { pathname } = useLocation();
  // Start each new page at the top.
  useEffect(() => { if (!window.location.hash) window.scrollTo(0, 0); }, [pathname]);

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-white focus:px-3 focus:py-2 focus:rounded">Skip to content</a>
      <Navbar />
      <main id="main" className="flex-1">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/how-it-works" element={<HowItWorksPage />} />
          <Route path="/assessment" element={<AssessmentPage />} />
          <Route path="/compliance" element={<CompliancePage />} />
          <Route path="/gateway" element={<GatewayPage />} />
          <Route path="/product" element={<Navigate to="/gateway" replace />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/deployment" element={<DeploymentPage />} />
          <Route path="/security" element={<SecurityPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
