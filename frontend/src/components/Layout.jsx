import { Outlet } from 'react-router-dom';
import Nav from './Nav';
import Footer from './Footer';
import ScrollToHash from './ScrollToHash';

export default function Layout() {
    return (
        <>
            <ScrollToHash />
            <Nav />
            <Outlet />
            <Footer />
        </>
    );
}
