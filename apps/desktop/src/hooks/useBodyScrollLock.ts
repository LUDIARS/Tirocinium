import { useEffect } from 'react';

// モーダル表示中は背面 (document.body) のスクロールを止め、 ホイール / タッチの
// スクロール chaining が裏のページへ伝播するのを防ぐ。 複数 / ネストしたモーダルでも
// 正しく動くよう参照カウントで管理する (最後の 1 枚が閉じたときだけ元に戻す)。
let lockCount = 0;
let prevOverflow = '';

/** マウント中だけ背面スクロールをロックするフック。 モーダルコンポーネントの先頭で呼ぶ。 */
export function useBodyScrollLock(): void {
  useEffect(() => {
    if (lockCount === 0) {
      prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    lockCount += 1;
    return () => {
      lockCount -= 1;
      if (lockCount === 0) {
        document.body.style.overflow = prevOverflow;
      }
    };
  }, []);
}
