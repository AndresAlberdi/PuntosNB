const fs = require('fs');
const path = require('path');

const files = [
  'src/pages/AdminDashboard.tsx',
  'src/pages/VendedorDashboard.tsx',
  'src/pages/SuperAdminDashboard.tsx'
];

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  
  // Replace blue variants with brand-primary
  content = content.replace(/bg-blue-50/g, 'bg-brand-bg-light');
  content = content.replace(/border-blue-100/g, 'border-brand-border');
  content = content.replace(/border-blue-200/g, 'border-brand-border');
  content = content.replace(/text-blue-900/g, 'text-brand-text-dark');
  content = content.replace(/text-blue-800/g, 'text-brand-text-dark');
  content = content.replace(/bg-blue-600/g, 'bg-brand-primary');
  content = content.replace(/bg-blue-700/g, 'bg-brand-primary-hover');
  content = content.replace(/hover:bg-blue-700/g, 'hover:bg-brand-primary-hover');
  content = content.replace(/text-blue-600/g, 'text-brand-primary');
  content = content.replace(/text-blue-700/g, 'text-brand-primary');
  content = content.replace(/bg-blue-100/g, 'bg-brand-bg-light');
  content = content.replace(/ring-blue-500/g, 'ring-brand-primary');
  content = content.replace(/border-blue-500/g, 'border-brand-primary');
  
  // Replace purple variants with brand-secondary
  content = content.replace(/bg-purple-50/g, 'bg-brand-bg-light');
  content = content.replace(/border-purple-100/g, 'border-brand-border');
  content = content.replace(/border-purple-200/g, 'border-brand-border');
  content = content.replace(/border-purple-300/g, 'border-brand-border');
  content = content.replace(/text-purple-900/g, 'text-brand-text-dark');
  content = content.replace(/text-purple-800/g, 'text-brand-text-dark');
  content = content.replace(/bg-purple-600/g, 'bg-brand-secondary');
  content = content.replace(/bg-purple-700/g, 'opacity-90');
  content = content.replace(/hover:bg-purple-700/g, 'hover:opacity-90');
  content = content.replace(/text-purple-600/g, 'text-brand-secondary');
  content = content.replace(/text-purple-700/g, 'text-brand-secondary');
  content = content.replace(/bg-purple-100/g, 'bg-brand-bg-light');
  content = content.replace(/ring-purple-500/g, 'ring-brand-secondary');
  
  fs.writeFileSync(file, content);
  console.log('Fixed ' + file);
});
