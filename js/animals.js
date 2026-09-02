// 동물 데이터는 전부 이 파일 한 곳에서만 관리한다.
// - KO_LABELS: MobileNet(ImageNet) 클래스명 -> 한글 이름
// - SPECIES   : 도감 슬롯 20종. aliases 에 적힌 한글 이름들이 이 종으로 모인다.
// 도감에 없는 동물도 인식되면 "야생 발견"으로 뒤에 붙는다(기존 150종 인식 능력 유지).

export const KO_LABELS = {
  'tabby':'고양이','egyptian cat':'고양이','persian cat':'고양이','siamese cat':'고양이','tiger cat':'고양이',
  'lynx':'스라소니','cougar':'퓨마','lion':'사자','tiger':'호랑이','leopard':'표범','snow leopard':'눈표범','jaguar':'재규어','cheetah':'치타',
  'golden retriever':'골든 리트리버','labrador retriever':'래브라도 리트리버','german shepherd':'저먼 셰퍼드',
  'standard poodle':'푸들','miniature poodle':'푸들','toy poodle':'푸들','beagle':'비글','french bulldog':'프렌치 불도그',
  'chihuahua':'치와와','siberian husky':'시베리안 허스키','pug':'퍼그','dalmatian':'달마시안',
  'pembroke':'웰시코기','cardigan':'웰시코기','shih-tzu':'시츄','pomeranian':'포메라니안',
  'wood rabbit':'토끼','hare':'토끼','angora':'토끼','hamster':'햄스터','guinea pig':'기니피그','fox squirrel':'다람쥐','marmot':'마멋',
  'african elephant':'코끼리','indian elephant':'코끼리','zebra':'얼룩말','sorrel':'말','ox':'소','water buffalo':'물소','bison':'들소',
  'ram':'양','bighorn':'양','ibex':'염소','hog':'돼지','wild boar':'멧돼지','warthog':'혹멧돼지','hippopotamus':'하마',
  'hen':'닭','cock':'닭','goose':'거위','black swan':'백조','peacock':'공작','african grey':'앵무새','macaw':'앵무새',
  'sulphur-crested cockatoo':'앵무새','bald eagle':'독수리','vulture':'독수리','great grey owl':'부엉이','flamingo':'플라밍고',
  'white stork':'황새','black stork':'황새','pelican':'펠리컨','king penguin':'펭귄','albatross':'알바트로스',
  'jay':'어치','magpie':'까치','robin':'울새','hummingbird':'벌새',
  'monarch':'나비','cabbage butterfly':'나비','sulphur butterfly':'나비','admiral':'나비','ringlet':'나비','lycaenid':'나비',
  'ant':'개미','bee':'벌','grasshopper':'메뚜기','cricket':'귀뚜라미','cockroach':'바퀴벌레','mantis':'사마귀','dragonfly':'잠자리',
  'ladybug':'무당벌레','rhinoceros beetle':'장수풍뎅이','dung beetle':'쇠똥구리',
  'long-horned beetle':'하늘소','ground beetle':'딱정벌레','leaf beetle':'잎벌레','tiger beetle':'길앞잡이','weevil':'바구미',
  'scorpion':'전갈','tarantula':'타란튤라','wolf spider':'거미','garden spider':'거미','black widow':'거미','tick':'진드기','centipede':'지네',
  'snail':'달팽이','slug':'민달팽이','jellyfish':'해파리','starfish':'불가사리','sea urchin':'성게',
  'bullfrog':'개구리','tree frog':'개구리','loggerhead':'거북','leatherback turtle':'거북','box turtle':'거북','terrapin':'거북','mud turtle':'거북',
  'common iguana':'이구아나','american chameleon':'카멜레온','komodo dragon':'코모도왕도마뱀','african crocodile':'악어','american alligator':'악어',
  'boa constrictor':'뱀','rock python':'뱀','indian cobra':'코브라','sea snake':'바다뱀','diamondback':'방울뱀','sidewinder':'방울뱀',
  'goldfish':'금붕어','great white shark':'상어','tiger shark':'상어','hammerhead':'상어','stingray':'가오리',
  'ostrich':'타조','goldfinch':'되새','toucan':'큰부리새','drake':'오리',
  'koala':'코알라','wombat':'웜뱃','sea lion':'바다사자','killer whale':'범고래','grey whale':'고래',
  'sloth bear':'곰','american black bear':'곰','brown bear':'곰','ice bear':'북극곰','giant panda':'판다',
  'gibbon':'긴팔원숭이','baboon':'개코원숭이','macaque':'마카크원숭이','proboscis monkey':'코주부원숭이','marmoset':'마모셋',
  'capuchin':'카푸친원숭이','squirrel monkey':'다람쥐원숭이','orangutan':'오랑우탄','gorilla':'고릴라','chimpanzee':'침팬지',
  'red fox':'여우','kit fox':'여우','arctic fox':'여우','grey fox':'여우','timber wolf':'늑대','white wolf':'늑대','coyote':'코요테','dingo':'딩고',
  'hyena':'하이에나','raccoon':'너구리','badger':'오소리','skunk':'스컹크','otter':'수달','mink':'밍크','weasel':'족제비','mongoose':'몽구스',
  'armadillo':'아르마딜로','three-toed sloth':'나무늘보','gazelle':'가젤','arabian camel':'낙타','llama':'라마',
  'porcupine':'고슴도치'
};

// 인식 결과 문자열이 KO_LABELS 에 있으면 한글 이름, 없으면 null(= 동물이 아닌 것으로 취급)
export function toKorean(className) {
  const parts = className.split(',').map(s => s.trim().toLowerCase());
  for (const p of parts) if (KO_LABELS[p]) return KO_LABELS[p];
  return null;
}

// rarity: 1 일반 / 2 희귀 / 3 매우 희귀 / 4 특별 / 5 전설
// 희귀도는 게임 요소일 뿐이라 인식 결과에는 전혀 관여하지 않는다.
export const SPECIES = [
  { id:'cat',       name:'고양이',   emoji:'🐱', rarity:1, description:'골목에서 제일 자주 만나는 도도한 친구.', aliases:[] },
  { id:'dog',       name:'강아지',   emoji:'🐶', rarity:1, description:'언제나 반겨주는 최고의 산책 친구.',
    aliases:['골든 리트리버','래브라도 리트리버','저먼 셰퍼드','푸들','비글','프렌치 불도그','치와와','시베리안 허스키','퍼그','달마시안','웰시코기','시츄','포메라니안'] },
  { id:'rabbit',    name:'토끼',     emoji:'🐰', rarity:1, description:'귀가 길고 폴짝폴짝 잘 뛴다.', aliases:[] },
  { id:'smallbird', name:'작은 새',  emoji:'🐦', rarity:1, description:'전깃줄 위에 앉아 노래하는 동네 새.', aliases:['까치','어치','울새','되새','벌새'] },
  { id:'chicken',   name:'닭',       emoji:'🐔', rarity:1, description:'아침을 깨우는 부지런한 친구.', aliases:[] },
  { id:'butterfly', name:'나비',     emoji:'🦋', rarity:1, description:'꽃 사이를 팔랑팔랑 날아다닌다.', aliases:[] },

  { id:'duck',      name:'오리',     emoji:'🦆', rarity:2, description:'물 위를 미끄러지듯 헤엄친다.', aliases:['거위'] },
  { id:'hamster',   name:'햄스터',   emoji:'🐹', rarity:2, description:'볼주머니에 간식을 잔뜩 넣고 다닌다.', aliases:['기니피그'] },
  { id:'squirrel',  name:'다람쥐',   emoji:'🐿️', rarity:2, description:'도토리를 숨겨두고 자주 까먹는다.', aliases:['마멋'] },
  { id:'ladybug',   name:'무당벌레', emoji:'🐞', rarity:2, description:'빨간 등에 까만 점을 콕콕 찍었다.', aliases:[] },
  { id:'frog',      name:'개구리',   emoji:'🐸', rarity:2, description:'비 오는 날이면 신나게 노래한다.', aliases:[] },
  { id:'turtle',    name:'거북',     emoji:'🐢', rarity:2, description:'느리지만 절대 포기하지 않는다.', aliases:[] },
  { id:'goldfish',  name:'금붕어',   emoji:'🐠', rarity:2, description:'반짝이는 지느러미로 유유히 헤엄친다.', aliases:[] },

  // 사슴벌레는 인식 모델(ImageNet)에 아예 없는 종이라 자동으로는 절대 안 잡힌다.
  // 그래도 도감에는 있어야 해서 넣어두고, "직접 고르기"로 등록하게 한다.
  { id:'stagbeetle',  name:'사슴벌레',   emoji:'🪲', rarity:3, description:'집게 같은 큰턱이 자랑거리인 숲의 장수.', aliases:[] },
  { id:'rhinobeetle', name:'장수풍뎅이', emoji:'🪲', rarity:3, description:'머리에 뿔을 달고 다니는 곤충계 씨름왕.', aliases:[] },

  { id:'horse',     name:'말',       emoji:'🐴', rarity:3, description:'바람처럼 초원을 달린다.', aliases:[] },
  { id:'fox',       name:'여우',     emoji:'🦊', rarity:3, description:'꾀 많고 꼬리가 복슬복슬하다.', aliases:[] },
  { id:'penguin',   name:'펭귄',     emoji:'🐧', rarity:3, description:'뒤뚱뒤뚱 걷다가 물에선 로켓이 된다.', aliases:[] },
  { id:'owl',       name:'부엉이',   emoji:'🦉', rarity:3, description:'밤의 숲을 지키는 조용한 파수꾼.', aliases:[] },

  { id:'elephant',  name:'코끼리',   emoji:'🐘', rarity:4, description:'긴 코로 인사할 줄 아는 거인.', aliases:[] },
  { id:'panda',     name:'판다',     emoji:'🐼', rarity:4, description:'하루 종일 대나무만 아작아작.', aliases:[] },

  { id:'tiger',     name:'호랑이',   emoji:'🐯', rarity:5, description:'산의 왕. 만나면 정말 행운이다!', aliases:[] }
];

export const DEX_TOTAL = SPECIES.length;

const BY_NAME = new Map();
const BY_ID = new Map();
for (const s of SPECIES) {
  BY_ID.set(s.id, s);
  BY_NAME.set(s.name, s);
  for (const a of s.aliases) BY_NAME.set(a, s);
}

// 도감 밖 동물도 계속 수집할 수 있도록 임시 종을 만들어준다.
function wildSpecies(name) {
  return { id: 'wild:' + name, name, emoji: '🐾', rarity: 1, description: '도감 밖에서 만난 특별한 친구.', wild: true, aliases: [] };
}

// 한글 이름 -> 종. 도감에 없으면 야생 종으로 만들어 돌려준다.
export function speciesForName(name) {
  return BY_NAME.get(name) || wildSpecies(name);
}

export function speciesById(id) {
  if (BY_ID.has(id)) return BY_ID.get(id);
  if (id.startsWith('wild:')) return wildSpecies(id.slice(5));
  return null;
}

// "직접 고르기" 목록: 도감 20여 종을 앞에 두고, 인식만 되는 나머지 이름을 가나다순으로 잇는다.
export const PICKABLE_NAMES = (() => {
  const dex = SPECIES.map(s => s.name);
  const rest = [...new Set(Object.values(KO_LABELS))]
    .filter(n => !BY_NAME.has(n))
    .sort((a, b) => a.localeCompare(b, 'ko'));
  return [...dex, ...rest];
})();

export const RARITY_LABEL = { 1:'일반', 2:'희귀', 3:'매우 희귀', 4:'특별', 5:'전설' };

export function stars(rarity) {
  return '★'.repeat(rarity) + '☆'.repeat(5 - rarity);
}
