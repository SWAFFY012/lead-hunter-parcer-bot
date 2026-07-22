/**
 * Spintax Parser
 * Parses and resolves {option1|option2|option3} syntax
 */

/**
 * Resolve spintax in a string
 * Example: "{Hello|Hi|Hey}, {world|there}" → "Hi, world"
 */
export function resolveSpintax(text) {
  // Recursively resolve nested spintax
  let result = text;
  let hasSpintax = true;

  while (hasSpintax) {
    hasSpintax = false;
    result = result.replace(/\{([^{}]+)\}/g, (match, group) => {
      hasSpintax = true;
      const options = group.split('|');
      return options[Math.floor(Math.random() * options.length)];
    });
  }

  return result;
}

/**
 * Substitute template variables from a lead object
 * Variables: {{name}}, {{title}}, {{city}}, {{text}}
 */
export function substituteVars(template, lead) {
  return template
    .replace(/\{\{name\}\}/g, lead.name || 'там')
    .replace(/\{\{title\}\}/g, lead.title || '')
    .replace(/\{\{city\}\}/g, lead.city || '')
    .replace(/\{\{text\}\}/g, (lead.ad_text || '').substring(0, 300))
    .replace(/\{\{phone\}\}/g, lead.phone || '');
}
