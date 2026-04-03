import type { Row } from '../types.js';

const BUILT_IN_TEMPLATES = new Set([
  'default-list',
  'default-table',
  'default-detail',
  'default-json',
]);

export function renderTemplate(template: string | ((rows: Row[]) => string), rows: Row[]): string {
  if (typeof template === 'function') {
    return template(rows);
  }

  switch (template) {
    case 'default-list':
      return rows.map(row => `- ${row['name'] ?? row['id'] ?? ''}`).join('\n') + (rows.length > 0 ? '\n' : '');

    case 'default-table': {
      if (rows.length === 0) return '';
      const headers = Object.keys(rows[0]);
      const headerRow = `| ${headers.join(' | ')} |`;
      const separator = `| ${headers.map(() => '---').join(' | ')} |`;
      const dataRows = rows.map(row =>
        `| ${headers.map(h => String(row[h] ?? '')).join(' | ')} |`
      );
      return [headerRow, separator, ...dataRows].join('\n') + '\n';
    }

    case 'default-detail': {
      if (rows.length === 0) return '';
      const row = rows[0];
      return Object.entries(row)
        .map(([k, v]) => `**${k}**: ${String(v ?? '')}`)
        .join('\n') + '\n';
    }

    case 'default-json':
      return JSON.stringify(rows, null, 2);

    default:
      // Handlebars-style template: apply to each row
      return rows
        .map(row => template.replace(/\{\{(\w+)\}\}/g, (_, k) => String(row[k] ?? '')))
        .join('');
  }
}

export { BUILT_IN_TEMPLATES };
