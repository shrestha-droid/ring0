// Build-time pre-render of the default view, so the first paint doesn't wait for JavaScript.
import { renderToString } from 'react-dom/server';
import { App } from './ui/App';

export const render = () => renderToString(<App />);
