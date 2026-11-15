/// 한국어 줄바꿈을 어절 단위로(CSS word-break: keep-all).
/// Flutter 는 한글을 글자마다 끊을 수 있어서, 어절 안 글자 사이에 단어 결합자(U+2060)를 넣는다.
String keepAll(String text) => text.split(' ').map((word) => word.split('').join('\u2060')).join(' ');
