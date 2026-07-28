import pc from 'picocolors';
import gradient from 'gradient-string';

const BANNER_TEXT = String.raw`
 ██████╗ ██╗   ██╗███████╗██╗   ██╗███████╗ ██████╗████████╗██╗         
██╔═══██╗██║   ██║██╔════╝██║   ██║██╔════╝██╔════╝╚══██╔══╝██║         
██║   ██║██║   ██║█████╗  ██║   ██║█████╗  ██║        ██║   ██║         
██║▄▄ ██║██║   ██║██╔══╝  ██║   ██║██╔══╝  ██║        ██║   ██║         
╚██████╔╝╚██████╔╝███████╗╚██████╔╝███████╗╚██████╗   ██║   ███████╗    
 ╚══▀▀═╝  ╚═════╝ ╚══════╝ ╚═════╝ ╚══════╝ ╚═════╝   ╚═╝   ╚══════╝    
`;

const BANNER_TAGLINE = 'Job Queue Manager for Node.js';

export function showBanner() {
  console.log(gradient(['#0038B8', '#FFFFFF', '#0038B8'])(BANNER_TEXT));
  console.log(pc.dim(BANNER_TAGLINE));
  console.log(pc.dim('____________________________________________________________\n'));
}
