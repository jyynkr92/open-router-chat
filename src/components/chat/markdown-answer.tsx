'use client';

import Markdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
  content: string;
}

const markdownComponents: Components = {
  a: ({ children, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

export const MarkdownAnswer = ({ content }: Props) => (
  <div className="markdown-answer">
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={markdownComponents}
      skipHtml
      disallowedElements={['img']}
      urlTransform={defaultUrlTransform}
    >
      {content}
    </Markdown>
  </div>
);
