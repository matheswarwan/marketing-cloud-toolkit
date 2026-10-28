// Query Builder help (feedback #150, like Data Cloud Inspector's help): one entry per
// control, used by the ? icons (HelpTip), the Help panel and the first-visit tips.

export const BUILDER_HELP = {
  overview: { title: 'How the Query Builder works', text: 'Pick data extensions or data views on the left (click, or drag them onto the canvas). Join them by dragging from a field on one card to a field on another. Tick the fields you want in the output. The SQL is written for you at the bottom; Run query sends it to Run Query.' },
  views: { title: 'Visual and List', text: 'Two views of the same query. Visual shows tables as cards on a canvas; List shows the same tables, joins, fields, filters and options as steps. Switch any time; the last one you used opens next time.' },
  newQuery: { title: 'New query', text: 'Starts an empty query. The one you were building stays in Saved queries and reopens from there.' },
  fromSql: { title: 'From SQL', text: 'Paste a SELECT and it is drawn as tables and joins. Data extensions are looked up in SFMC; expressions the builder cannot model are kept as written. Comments and formatting are not kept.' },
  union: { title: '+ UNION', text: 'Adds another SELECT combined with UNION ALL. Each SELECT gets a tab; the operator between two tabs can be UNION ALL, UNION, EXCEPT or INTERSECT.' },
  diagramforce: { title: 'Diagramforce', text: 'Opens the query as a diagram on diagramforce.com, a free diagram editor: the data model (tables and join lines) or the lineage (which source fields feed each output column). Only table and field names are sent.' },
  sql: { title: 'Generated SQL', text: 'The SQL for what you built, at the bottom. Minimize it to a bar, open it, or maximize it. You can edit it; Apply to builder redraws the builder from your edit. Copy, Save to Saved queries, or Run query in Run Query.' },
  cards: { title: 'Cards', text: 'One card per table, with its alias (short name used in the SQL) and fields. Tick a field to put it in the output; drag from the dot beside a field to a field on another card to join them. The crown makes a card the FROM table; the magnifier finds a field; filter adds a WHERE condition on that field.' },
  joins: { title: 'Joins', text: 'The label on a line is the join type: Inner keeps rows found in both tables, Left keeps every row of the earlier table, Right every row of the joined one, Full both. Click it to change the type, the fields, the operator, add conditions or write the ON by hand.' },
  canvasTools: { title: 'Canvas tools', text: 'Auto layout arranges the cards along the joins; Fit shows them all; Map shows a small overview; Subquery adds a SELECT used as a table. Scroll to zoom, drag the background to move around.' },
  filters: { title: 'Filters & options', text: 'Filters (WHERE) with AND/OR groups, or a condition written in SQL. Output columns sets the order and names (AS). Options: DISTINCT, TOP, GROUP BY with HAVING, ORDER BY and computed columns such as COUNT or SUM.' },
  aliases: { title: 'Aliases', text: 'Each table gets a short alias from its name (cm for Customer Master, sub for _Subscribers), so a column like cm.[Email] says where it comes from. Edit it in List view; it must be unique in the query.' },
}

/** The Help panel's order. */
export const BUILDER_HELP_ORDER = ['overview', 'views', 'cards', 'joins', 'canvasTools', 'filters', 'sql', 'aliases', 'fromSql', 'union', 'diagramforce', 'newQuery']
