import { describe, it, expect } from 'vitest';
import {
  analyzeEsFromNotion,
  analyzeEs,
  analyzeInterviewFromChat,
  analyzeInterviewFromNotion,
  analyzeInterview,
  esToTrainingDoc,
  interviewToTrainingDoc,
} from './analyze.js';

function notionText(id: number, cls: string, text: string): string {
  return `<div data-block-id="${id}" class="${cls}"><div contenteditable="true">${text}</div></div>`;
}

function notionPage(blocks: string): string {
  return `<div class="notion-page-content">${blocks}</div>`;
}

describe('analyzeEsFromNotion', () => {
  it('見出しでセクション分割する', () => {
    const html = notionPage(
      notionText(1, 'notion-header-block', '自己PR') +
        notionText(2, 'notion-text-block', '私は継続力があります') +
        notionText(3, 'notion-header-block', '志望動機') +
        notionText(4, 'notion-text-block', '御社の理念に共感しました'),
    );
    const es = analyzeEsFromNotion(html, 'マイES');
    expect(es.title).toBe('マイES');
    expect(es.sections).toEqual([
      { heading: '自己PR', body: '私は継続力があります' },
      { heading: '志望動機', body: '御社の理念に共感しました' },
    ]);
    expect(es.text).toBe('## 自己PR\n私は継続力があります\n\n## 志望動機\n御社の理念に共感しました');
  });

  it('箇条書きは - を付ける', () => {
    const html = notionPage(
      notionText(1, 'notion-header-block', 'スキル') +
        notionText(2, 'notion-bulleted_list-block', 'TypeScript') +
        notionText(3, 'notion-bulleted_list-block', 'Rust'),
    );
    const es = analyzeEsFromNotion(html);
    expect(es.sections[0]?.body).toBe('- TypeScript\n- Rust');
  });
});

describe('analyzeInterviewFromChat', () => {
  it('assistant=面接官 / user=受験者 で Q&A に畳む', () => {
    const html =
      '<title>模擬面接</title>' +
      '<div data-message-author-role="assistant" data-message-id="a">自己紹介をお願いします</div>' +
      '<div data-message-author-role="user" data-message-id="b">中村と申します</div>' +
      '<div data-message-author-role="assistant" data-message-id="c">強みは何ですか</div>' +
      '<div data-message-author-role="user" data-message-id="d">継続力です</div>';
    const t = analyzeInterviewFromChat(html, 'chatgpt');
    expect(t.title).toBe('模擬面接');
    expect(t.exchanges).toEqual([
      { question: '自己紹介をお願いします', answer: '中村と申します' },
      { question: '強みは何ですか', answer: '継続力です' },
    ]);
    expect(t.text).toBe('Q1. 自己紹介をお願いします\nA1. 中村と申します\n\nQ2. 強みは何ですか\nA2. 継続力です');
  });
});

describe('analyzeInterviewFromNotion', () => {
  it('行頭 Q/A マーカーで Q&A を分割する', () => {
    const html = notionPage(
      notionText(1, 'notion-text-block', 'Q1. 志望動機は?') +
        notionText(2, 'notion-text-block', 'A1. 成長環境だからです') +
        notionText(3, 'notion-text-block', 'Q2. 弱みは?') +
        notionText(4, 'notion-text-block', 'A2. 心配性なところです'),
    );
    const t = analyzeInterviewFromNotion(html);
    expect(t.exchanges).toEqual([
      { question: '志望動機は?', answer: '成長環境だからです' },
      { question: '弱みは?', answer: '心配性なところです' },
    ]);
  });

  it('マーカーが無ければ見出しを質問とする fallback', () => {
    const html = notionPage(
      notionText(1, 'notion-header-block', 'なぜ弊社を志望?') +
        notionText(2, 'notion-text-block', '理念に共感したからです'),
    );
    const t = analyzeInterviewFromNotion(html);
    expect(t.exchanges).toEqual([
      { question: 'なぜ弊社を志望?', answer: '理念に共感したからです' },
    ]);
  });
});

describe('analyzeEs / analyzeInterview (URL auto-detect)', () => {
  it('Notion URL → ES', () => {
    const html = notionPage(notionText(1, 'notion-text-block', '本文'));
    expect(analyzeEs('https://notion.so/x', html)?.sections).toHaveLength(1);
  });

  it('chat URL → 面接', () => {
    const html =
      '<div data-message-author-role="assistant" data-message-id="a">質問</div>' +
      '<div data-message-author-role="user" data-message-id="b">回答</div>';
    expect(analyzeInterview('https://chatgpt.com/c/1', html)?.exchanges).toHaveLength(1);
  });

  it('未対応 URL は null', () => {
    expect(analyzeEs('https://example.com', '<html></html>')).toBeNull();
    expect(analyzeInterview('https://example.com', '<html></html>')).toBeNull();
  });
});

describe('TrainingDocInput 変換', () => {
  it('esToTrainingDoc は kind=es', () => {
    const es = analyzeEsFromNotion(notionPage(notionText(1, 'notion-text-block', 'x')));
    const doc = esToTrainingDoc(es, 'user-1', ['ソフトウェア']);
    expect(doc).toEqual({ user_id: 'user-1', kind: 'es', body: es.text, tags: ['ソフトウェア'] });
  });

  it('interviewToTrainingDoc は kind=past_qa', () => {
    const t = analyzeInterviewFromChat(
      '<div data-message-author-role="assistant" data-message-id="a">Q</div>' +
        '<div data-message-author-role="user" data-message-id="b">A</div>',
      'chatgpt',
    );
    const doc = interviewToTrainingDoc(t, 'user-1');
    expect(doc.kind).toBe('past_qa');
    expect(doc.user_id).toBe('user-1');
    expect(doc.body).toBe(t.text);
  });
});
