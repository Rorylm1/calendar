import type { Metadata, Viewport } from 'next';
import { Gabarito, Hanken_Grotesk, IBM_Plex_Mono, IBM_Plex_Sans, Manrope, Newsreader } from 'next/font/google';
import './globals.css';
import './iterations.css';
const gabarito=Gabarito({subsets:['latin'],variable:'--font-gabarito',display:'swap'});
const hanken=Hanken_Grotesk({subsets:['latin'],variable:'--font-hanken',display:'swap'});
const mono=IBM_Plex_Mono({subsets:['latin'],weight:['400','500'],variable:'--font-plex-mono',display:'swap'});
const plex=IBM_Plex_Sans({subsets:['latin'],weight:['400','500','600'],variable:'--font-plex',display:'swap'});
const manrope=Manrope({subsets:['latin'],variable:'--font-manrope',display:'swap'});
const newsreader=Newsreader({subsets:['latin'],style:['normal','italic'],variable:'--font-newsreader',display:'swap'});
export const metadata: Metadata = { title:'My Calendar', description:'Your plans, in one place.',icons:{icon:'/favicon.svg',apple:'/app-icon/180'},appleWebApp:{capable:true,statusBarStyle:'black-translucent',title:'Calendar'},robots:{index:false,follow:false} };
export const viewport: Viewport = { themeColor: '#192330', width: 'device-width', initialScale: 1, viewportFit: 'cover' };
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body className={`${gabarito.variable} ${hanken.variable} ${mono.variable} ${plex.variable} ${manrope.variable} ${newsreader.variable}`}>{children}</body></html>}
