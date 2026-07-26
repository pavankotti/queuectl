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

export function showBanner() {
  console.log(gradient(['#59C173', '#a17fe0', '#5D26C1'])(BANNER_TEXT));
  console.log(pc.dim('Job Queue Manager for Node.js'));
  console.log(pc.dim('____________________________________________________________\n'));
}
