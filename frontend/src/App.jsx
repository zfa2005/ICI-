import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Team from './pages/Team';
import Contact from './pages/Contact';
import DataExplorer from './pages/DataExplorer';
import Assistant from './pages/Assistant';

export default function App() {
    return (
        <BrowserRouter basename={import.meta.env.BASE_URL}>
            <Routes>
                <Route element={<Layout />}>
                    <Route path="/" element={<Home />} />
                    <Route path="/team" element={<Team />} />
                    <Route path="/contact" element={<Contact />} />
                </Route>
                <Route path="/chatbot" element={<DataExplorer />} />
                <Route path="/assistant" element={<Assistant />} />
            </Routes>
        </BrowserRouter>
    );
}
