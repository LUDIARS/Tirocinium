// Shared private pairing controls. Commands are shown only in the authenticated page.
document.addEventListener('click', async function (event) {
  if (!(event.target instanceof HTMLElement)) return;
  var connect = event.target.getAttribute('data-review-connect');
  var close = event.target.getAttribute('data-review-close');
  var id = connect || close;
  if (!id) return;
  if (close && !confirm('相談を終了しますか？以後の返信は中継されません。既に届いたDiscordメッセージは残ります。')) return;
  event.target.setAttribute('disabled', 'disabled');
  try {
    var result = await fetch('/api/v1/es-review/' + encodeURIComponent(id) + (connect ? '/discord' : '/close'), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + (localStorage.getItem('cernere_token') || '') },
    });
    if (!result.ok) throw new Error('request failed');
    var data = await result.json();
    if (connect) {
      var panel = document.createElement('dialog');
      var explanation = document.createElement('p');
      explanation.textContent = '次のコマンドをTirocinium Botへの個別DMに貼り付けてください（10分間有効）。第三者に共有しないでください。再発行すると以前の接続は解除されます。';
      var command = document.createElement('textarea');
      command.readOnly = true;
      command.value = data.command;
      command.rows = 3;
      command.style.width = '100%';
      var done = document.createElement('button');
      done.textContent = '閉じる';
      done.onclick = function () { panel.close(); };
      panel.addEventListener('close', function () { panel.remove(); });
      panel.append(explanation, command, done);
      document.body.append(panel);
      panel.showModal();
      command.select();
    } else {
      location.reload();
    }
  } catch {
    alert('操作できませんでした。ログイン、相談の状態、Botの設定を確認してください。');
  } finally {
    event.target.removeAttribute('disabled');
  }
});
