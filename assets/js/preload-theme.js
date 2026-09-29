/**
 * Roda antes de tudo: aplica tema e modo privacidade já salvos para a página
 * não "piscar" branco antes do app carregar.
 *
 * Fica num arquivo separado (em vez de inline no HTML) porque a política de
 * segurança do site proíbe script embutido.
 */
try {
  var theme = localStorage.getItem('i7even.theme');
  if (theme === 'dark' || theme === 'light') {
    document.documentElement.setAttribute('data-theme', theme);
  }
  if (localStorage.getItem('i7even.privacy') === 'on') {
    document.documentElement.setAttribute('data-privacy', 'on');
  }
} catch (e) {
  /* navegador com armazenamento bloqueado — segue no tema automático */
}
