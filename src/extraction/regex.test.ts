import {
  extractWorldName,
  extractAuthorName,
  extractWorldAndAuthorByLines,
  extractWorldAndAuthor,
  customMatchers,
  extractWithCustomMatcher,
  extractAllWorldIds,
  extractAllLinks,
  isTwitterLink
} from './regex';

// Mock the config to avoid environment variable dependencies
vi.mock('../config', () => {
  return {
    __esModule: true,
    default: {
      VRC_USERNAME: 'mock-username',
      VRC_PASSWORD: 'mock-password',
      VRC_TOTP_KEY: 'mock-totp-key',
      WORLD_NAME_MATCHERS: [
        'World:',
        'World :',
        '📸✨🌏World:',
        'World name:',
        'World',
        'ワールド名',
        'world：',
        'World：'
      ],
      AUTHOR_NAME_MATCHERS: [
        'Author:',
        'Author :',
        '👤Author:',
        'By:',
        'Author',
        'by',
        'By ：',
        'Author：'
      ]
    }
  };
});

vi.mock('../logger', () => ({
  __esModule: true,
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

const testData = [
  //Bradlee1011
  `World name: RSpec_v2
︀︀By: Remmieǃ
︀︀Platform: PC
︀︀
︀︀#VRChat #VRChat_world紹介`,
  // asobouofficial
  `Artificial? Maybe, but she looked right at me.
︀︀
︀︀World: Cyber 2049 by Alice · 爱丽丝黑白
︀︀
︀︀#VRChat #VRChatphotography #VirtualPhotography #Velle3D`,
  // CupitanVR
  `World : 星今宵
︀︀Author : しーの／T_Shiino
︀︀
︀︀#VRChat #VRChatワールド紹介
︀︀#VRChat_world #VRChat_world紹介`,
  //Jessi55xc
  `World: Hong Kong Street （Night）
Author: Marc_99 @MarcVRCHK

#VRC #VRChat_world紹介 #VRChatPhotography #VirtualPhotography #VRChatワールド紹介 #vrchatworld #VRChat`,
  //Choconrock
  `Achromatic Area
︀︀
︀︀VRChat World : Replicant
︀︀Author : Kakulity
︀︀
︀︀#VRChat
︀︀#VRChat_world紹介
︀︀#VRChatPhotography`,
  //@Yukichi26990880
  // eslint-disable-next-line no-irregular-whitespace
  `ワールド名　B5区画検問所 - B5 Section Checkpoint
  By 暇神／Himajin514
  #VRChat_world紹介
  #VRChat`,
  //@2Y6yzB93ibkUUMS
  `
  #VRChat #VRChat_world紹介
World : Liminal - Room Tours
Author : ~Zoid~
`,
  // Tokyo Mood format
  `World: Tokyo Mood by BEAMS Summer Version 
Author: BEAMS_STAFF_1 

#n4n0_pic 
#VRChat_world紹介 https://t.co/nxaHwhERgE`,
  `
  バス停がある真夏の風景のワールド
︀︀マップが広くて色々な場所にスポットがあるようだ
︀︀空を入れて撮影すると夏らしい1枚が撮れる
︀︀world：炎天、途中下車 -One day in the summer-
︀︀By ：だにゃえる
︀︀タグ：景観
  `
];

describe('regex', () => {
  describe('customMatchers', () => {
    describe('n4rGm5DmrVXXz6I', () => {
      const exampleTweet =
        '星灯の丘 -Where the Night Learned to Shine-\n' +
        '円花_madoka\n' +
        '--\n' +
        '美しい夜空に星々が瞬き、丘の中央には小さくモダンな長方形の建築が静かに佇む。芝生の上を転がる星を追う。歩いた場所には、くっきりと草が倒れた跡が刻まれていく。\n' +
        '#VRChat_world紹介 #VRChat #VRC';

      it('getWorldName extracts line 1 as world name', () => {
        expect(customMatchers.n4rGm5DmrVXXz6I.getWorldName(exampleTweet)).toBe(
          '星灯の丘 -Where the Night Learned to Shine-'
        );
      });

      it('getAuthorName extracts line 2 as author name', () => {
        expect(customMatchers.n4rGm5DmrVXXz6I.getAuthorName(exampleTweet)).toBe(
          '円花_madoka'
        );
      });

      it('returns null for empty content', () => {
        expect(customMatchers.n4rGm5DmrVXXz6I.getWorldName('')).toBeNull();
        expect(customMatchers.n4rGm5DmrVXXz6I.getAuthorName('')).toBeNull();
      });

      it('trims whitespace on the first two lines', () => {
        const content = '  World Name  \n  Author Name  \n#tag';
        expect(customMatchers.n4rGm5DmrVXXz6I.getWorldName(content)).toBe(
          'World Name'
        );
        expect(customMatchers.n4rGm5DmrVXXz6I.getAuthorName(content)).toBe(
          'Author Name'
        );
      });

      it('returns null when author line is missing', () => {
        expect(
          customMatchers.n4rGm5DmrVXXz6I.getAuthorName('Only World')
        ).toBeNull();
      });
    });

    describe('YSoSerious_VR', () => {
      const exampleTweet =
        'day by day\n' +
        'By ＊るう＊\n' +
        '#VRChat #VRChat_world紹介 #VRChatワールド紹介 #VRChatPhotography #VirtualPhotography';

      it('getWorldName extracts line 1 as world name', () => {
        expect(customMatchers.YSoSerious_VR.getWorldName(exampleTweet)).toBe(
          'day by day'
        );
      });

      it('getAuthorName strips "By" prefix from line 2', () => {
        expect(customMatchers.YSoSerious_VR.getAuthorName(exampleTweet)).toBe(
          '＊るう＊'
        );
      });

      it('getAuthorName handles full-width colon', () => {
        const content = 'World Title\nBy：Author Name\n#tag';
        expect(customMatchers.YSoSerious_VR.getAuthorName(content)).toBe(
          'Author Name'
        );
      });

      it('returns null for empty content', () => {
        expect(customMatchers.YSoSerious_VR.getWorldName('')).toBeNull();
        expect(customMatchers.YSoSerious_VR.getAuthorName('')).toBeNull();
      });

      it('returns null when author line is missing or empty after strip', () => {
        expect(
          customMatchers.YSoSerious_VR.getAuthorName('Only World')
        ).toBeNull();
        expect(
          customMatchers.YSoSerious_VR.getAuthorName('World\nBy:   ')
        ).toBeNull();
      });
    });

    describe('tetra_moon', () => {
      const exampleTweet =
        'ワールド　深海トンネルーUndersea Tunnel\n' +
        '作者様　　そばこんぶ。\n' +
        '\n' +
        '海底トンネルのチルワールド\n' +
        '外を泳ぐ色んな魚を眺めてゆっくりできる\n' +
        'ちょっと薄暗いけどホラー要素は一切ないので、良い感じの写真を撮ろう\n' +
        '#VRChat_world紹介 #VRChat';

      it('getWorldName strips ワールド prefix (full-width spaces)', () => {
        expect(customMatchers.tetra_moon.getWorldName(exampleTweet)).toBe(
          '深海トンネルーUndersea Tunnel'
        );
      });

      it('getAuthorName strips 作者様 prefix (full-width spaces)', () => {
        expect(customMatchers.tetra_moon.getAuthorName(exampleTweet)).toBe(
          'そばこんぶ。'
        );
      });

      it('returns null for empty content', () => {
        expect(customMatchers.tetra_moon.getWorldName('')).toBeNull();
        expect(customMatchers.tetra_moon.getAuthorName('')).toBeNull();
      });

      it('returns null when lines do not match the label pattern', () => {
        expect(
          customMatchers.tetra_moon.getWorldName('Plain title\n作者様　x')
        ).toBeNull();
        expect(
          customMatchers.tetra_moon.getAuthorName('ワールド　x\nPlain line')
        ).toBeNull();
      });

      it('finds world/author lines even when they follow intro text', () => {
        const content =
          'おひるー！\n今頃私はヒマワリ畑へお出かけしているはず！\n' +
          '\nワールド　夏の痕跡 -Summer Traces-\n作者様　　mackerel_misogi';
        expect(customMatchers.tetra_moon.getWorldName(content)).toBe(
          '夏の痕跡 -Summer Traces-'
        );
        expect(customMatchers.tetra_moon.getAuthorName(content)).toBe(
          'mackerel_misogi'
        );
      });
    });

    describe('jhn_takashi2020', () => {
      const exampleTweet =
        '#tags\n\nWorldInfo:\n' +
        '虚拟数码博物馆V1․1 Virtual Digital Product Museum by Con11';

      it('getWorldName parses WorldInfo line before " by "', () => {
        expect(customMatchers.jhn_takashi2020.getWorldName(exampleTweet)).toBe(
          '虚拟数码博物馆V1․1 Virtual Digital Product Museum'
        );
      });

      it('getAuthorName parses WorldInfo line after " by "', () => {
        expect(customMatchers.jhn_takashi2020.getAuthorName(exampleTweet)).toBe(
          'Con11'
        );
      });

      it('supports WorldInfo on same line as payload', () => {
        const content = 'WorldInfo: Some World Name by SomeAuthor\n#tag';
        expect(customMatchers.jhn_takashi2020.getWorldName(content)).toBe(
          'Some World Name'
        );
        expect(customMatchers.jhn_takashi2020.getAuthorName(content)).toBe(
          'SomeAuthor'
        );
      });

      it('returns null for empty content', () => {
        expect(customMatchers.jhn_takashi2020.getWorldName('')).toBeNull();
        expect(customMatchers.jhn_takashi2020.getAuthorName('')).toBeNull();
      });

      it('returns null when WorldInfo or " by " is missing', () => {
        expect(
          customMatchers.jhn_takashi2020.getWorldName('No block here')
        ).toBeNull();
        expect(
          customMatchers.jhn_takashi2020.getAuthorName('WorldInfo:\nNo by')
        ).toBeNull();
      });
    });

    describe('yonesuke2', () => {
      const exampleTweet =
        'Valhalla Garden 星屑の庭\n' +
        'ByCOMA\u2024\n' +
        '無人の図書館の机に開かれた本を通して辿り着く異世界\n' +
        '壊れた巨大な鳥かごの前に眠るドラゴンの前には無数の武具が\n' +
        'いくつかの武器に触れるとワールドの雰囲気を変えるギミックがあり撮影などに\n' +
        '#VRChat #VRChatワールド紹介 #VRChat_World紹介';

      it('getWorldName extracts line 1 as world name', () => {
        expect(customMatchers.yonesuke2.getWorldName(exampleTweet)).toBe(
          'Valhalla Garden 星屑の庭'
        );
      });

      it('getAuthorName strips tight "By" prefix from line 2', () => {
        expect(customMatchers.yonesuke2.getAuthorName(exampleTweet)).toBe(
          'COMA\u2024'
        );
      });

      it('returns null for empty content', () => {
        expect(customMatchers.yonesuke2.getWorldName('')).toBeNull();
        expect(customMatchers.yonesuke2.getAuthorName('')).toBeNull();
      });

      it('returns null when author line is missing', () => {
        expect(customMatchers.yonesuke2.getAuthorName('Only World')).toBeNull();
      });
    });

    describe('fox_yata9', () => {
      const exampleTweet =
        'World:Speed Puzzler （jigsaws done right）(QUEST対応)\n' +
        'By:PlayerBush001\n' +
        '\n' +
        '皆で協力してジグソーパズルを完成させよう\n' +
        '#VRChat_world紹介\n' +
        '#ヤタノの漫遊記';

      it('getWorldName strips World: and (QUEST対応)', () => {
        expect(customMatchers.fox_yata9.getWorldName(exampleTweet)).toBe(
          'Speed Puzzler （jigsaws done right）'
        );
      });

      it('getWorldName strips (iOS対応)', () => {
        const tweet = 'World:Some World Name(iOS対応)\n' + 'By:AuthorName\n';
        expect(customMatchers.fox_yata9.getWorldName(tweet)).toBe(
          'Some World Name'
        );
      });

      it('getWorldName strips (QUEST対応) and (iOS対応) when both present', () => {
        const tweet =
          'World:Hybrid World(QUEST対応)(iOS対応)\n' + 'By:AuthorName\n';
        expect(customMatchers.fox_yata9.getWorldName(tweet)).toBe(
          'Hybrid World'
        );
      });

      it('getAuthorName strips By: prefix', () => {
        expect(customMatchers.fox_yata9.getAuthorName(exampleTweet)).toBe(
          'PlayerBush001'
        );
      });

      it('returns null for empty content', () => {
        expect(customMatchers.fox_yata9.getWorldName('')).toBeNull();
        expect(customMatchers.fox_yata9.getAuthorName('')).toBeNull();
      });

      it('returns null when World or By line is missing', () => {
        expect(
          customMatchers.fox_yata9.getWorldName('By:OnlyAuthor\n')
        ).toBeNull();
        expect(
          customMatchers.fox_yata9.getAuthorName('World:OnlyWorld\n')
        ).toBeNull();
      });
    });

    describe('Katu_VRC', () => {
      const exampleTweet =
        'BLUE STARS　フリー交流会　観覧\n' +
        'ヘリ、飛行機(ｼﾞｪｯﾄ/ﾚｼﾌﾟﾛ)、戦車etc,,わちゃわちゃ賑やかな仙台空港を遊覧\n' +
        '精巧なEC225かっこいい✨\n' +
        'ありがとうございました\n' +
        '\n' +
        'ワールド：JVG Sendai Air Station 【仮想保安庁 仙台航空基地】By Oppailot\n' +
        '#VRCAviation #VRC_BLUE_STARS #VRChat';

      it('getWorldName strips ワールド： prefix and trailing By author', () => {
        expect(customMatchers.Katu_VRC.getWorldName(exampleTweet)).toBe(
          'JVG Sendai Air Station 【仮想保安庁 仙台航空基地】'
        );
      });

      it('getAuthorName extracts the name after By', () => {
        expect(customMatchers.Katu_VRC.getAuthorName(exampleTweet)).toBe(
          'Oppailot'
        );
      });

      it('handles By without preceding space', () => {
        const content = 'ワールド：Some World【別名】By AuthorName\n#VRChat';
        expect(customMatchers.Katu_VRC.getWorldName(content)).toBe(
          'Some World【別名】'
        );
        expect(customMatchers.Katu_VRC.getAuthorName(content)).toBe(
          'AuthorName'
        );
      });

      it('returns null for empty content', () => {
        expect(customMatchers.Katu_VRC.getWorldName('')).toBeNull();
        expect(customMatchers.Katu_VRC.getAuthorName('')).toBeNull();
      });

      it('returns null when ワールド line or By author is missing', () => {
        expect(
          customMatchers.Katu_VRC.getWorldName('No world line')
        ).toBeNull();
        expect(
          customMatchers.Katu_VRC.getAuthorName('ワールド：World Only')
        ).toBeNull();
      });
    });
  });

  describe('extractWithCustomMatcher', () => {
    const ysoTweet =
      'day by day\n' +
      'By ＊るう＊\n' +
      '#VRChat #VRChat_world紹介 #VRChatワールド紹介 #VRChatPhotography #VirtualPhotography';

    const n4Tweet =
      '星灯の丘 -Where the Night Learned to Shine-\n' +
      '円花_madoka\n' +
      '--\n' +
      '美しい夜空に星々が瞬き、丘の中央には小さくモダンな長方形の建築が静かに佇む。芝生の上を転がる星を追う。歩いた場所には、くっきりと草が倒れた跡が刻まれていく。\n' +
      '#VRChat_world紹介 #VRChat #VRC';

    it('matches YSoSerious_VR and returns world + author', () => {
      const result = extractWithCustomMatcher(
        'https://twitter.com/YSoSerious_VR/status/123',
        ysoTweet
      );
      expect(result).toEqual({
        worldName: 'day by day',
        authorName: '＊るう＊'
      });
    });

    it('matches n4rGm5DmrVXXz6I and returns world + author', () => {
      const result = extractWithCustomMatcher(
        'https://x.com/n4rGm5DmrVXXz6I/status/123',
        n4Tweet
      );
      expect(result).toEqual({
        worldName: '星灯の丘 -Where the Night Learned to Shine-',
        authorName: '円花_madoka'
      });
    });

    it('matches tetra_moon and returns world + author', () => {
      const tetraTweet =
        'ワールド　深海トンネルーUndersea Tunnel\n' +
        '作者様　　そばこんぶ。\n' +
        '\n' +
        '海底トンネルのチルワールド\n' +
        '#VRChat_world紹介 #VRChat';
      const result = extractWithCustomMatcher(
        'https://x.com/tetra_moon/status/123',
        tetraTweet
      );
      expect(result).toEqual({
        worldName: '深海トンネルーUndersea Tunnel',
        authorName: 'そばこんぶ。'
      });
    });

    it('matches tetra_moon with world/author after intro text', () => {
      const tetraTweet =
        'おひるー！\n今頃私はヒマワリ畑へお出かけしているはず！\n' +
        'きっと晴れで良い感じの写真を撮れているはず！\n' +
        '晴れていて欲しいなぁー！\n' +
        '\n' +
        'ワールド　夏の痕跡 -Summer Traces-\n' +
        '作者様　　mackerel_misogi';
      const result = extractWithCustomMatcher(
        'https://x.com/tetra_moon/status/123',
        tetraTweet
      );
      expect(result).toEqual({
        worldName: '夏の痕跡 -Summer Traces-',
        authorName: 'mackerel_misogi'
      });
    });

    it('matches yonesuke2 and returns world + author', () => {
      const yonesukeTweet =
        'Valhalla Garden 星屑の庭\n' +
        'ByCOMA\u2024\n' +
        '無人の図書館の机に開かれた本を通して辿り着く異世界\n' +
        '#VRChat #VRChatワールド紹介 #VRChat_World紹介';
      const result = extractWithCustomMatcher(
        'https://x.com/yonesuke2/status/123',
        yonesukeTweet
      );
      expect(result).toEqual({
        worldName: 'Valhalla Garden 星屑の庭',
        authorName: 'COMA\u2024'
      });
    });

    it('matches jhn_takashi2020 and returns world + author', () => {
      const jhnTweet =
        '#愛すべきクセすごツアー\n\nWorldInfo:\n' +
        '虚拟数码博物馆V1․1 Virtual Digital Product Museum by Con11';
      const result = extractWithCustomMatcher(
        'https://x.com/jhn_takashi2020/status/123',
        jhnTweet
      );
      expect(result).toEqual({
        worldName: '虚拟数码博物馆V1․1 Virtual Digital Product Museum',
        authorName: 'Con11'
      });
    });

    it('matches fox_yata9 and returns world + author', () => {
      const foxTweet =
        'World:Speed Puzzler （jigsaws done right）(QUEST対応)\n' +
        'By:PlayerBush001\n' +
        '\n' +
        '皆で協力してジグソーパズルを完成させよう\n' +
        '#VRChat_world紹介';
      const result = extractWithCustomMatcher(
        'https://x.com/fox_yata9/status/123',
        foxTweet
      );
      expect(result).toEqual({
        worldName: 'Speed Puzzler （jigsaws done right）',
        authorName: 'PlayerBush001'
      });
    });

    it('matches Katu_VRC and returns world + author', () => {
      const katuTweet =
        'BLUE STARS　フリー交流会　観覧\n' +
        'ヘリ、飛行機(ｼﾞｪｯﾄ/ﾚｼﾌﾟﾛ)、戦車etc,,わちゃわちゃ賑やかな仙台空港を遊覧\n' +
        '精巧なEC225かっこいい✨\n' +
        'ありがとうございました\n' +
        '\n' +
        'ワールド：JVG Sendai Air Station 【仮想保安庁 仙台航空基地】By Oppailot\n' +
        '#VRCAviation #VRC_BLUE_STARS #VRChat';
      const result = extractWithCustomMatcher(
        'https://x.com/Katu_VRC/status/2088781152698208349',
        katuTweet
      );
      expect(result).toEqual({
        worldName: 'JVG Sendai Air Station 【仮想保安庁 仙台航空基地】',
        authorName: 'Oppailot'
      });
    });

    it('is case-insensitive for matcher keys', () => {
      const result = extractWithCustomMatcher(
        'https://twitter.com/ysoSerious_vr/status/123',
        ysoTweet
      );
      expect(result).toEqual({
        worldName: 'day by day',
        authorName: '＊るう＊'
      });
    });

    it('returns null when content does not yield both world and author', () => {
      expect(
        extractWithCustomMatcher(
          'https://twitter.com/YSoSerious_VR/status/1',
          'World\nBy:   '
        )
      ).toBeNull();
    });

    it('returns null when no matcher key matches the link', () => {
      expect(
        extractWithCustomMatcher(
          'https://twitter.com/someone_else/status/1',
          ysoTweet
        )
      ).toBeNull();
    });

    it('returns null for invalid inputs', () => {
      expect(extractWithCustomMatcher('', ysoTweet)).toBeNull();
      expect(
        extractWithCustomMatcher('https://twitter.com/YSoSerious_VR', '')
      ).toBeNull();
      expect(
        extractWithCustomMatcher(null as unknown as string, ysoTweet)
      ).toBeNull();
      expect(
        extractWithCustomMatcher(
          'https://twitter.com/YSoSerious_VR',
          null as unknown as string
        )
      ).toBeNull();
      expect(
        extractWithCustomMatcher(123 as unknown as string, ysoTweet)
      ).toBeNull();
      expect(
        extractWithCustomMatcher(
          'https://twitter.com/YSoSerious_VR',
          123 as unknown as string
        )
      ).toBeNull();
    });
  });

  describe('extractWorldName', () => {
    it('Extracts correctly from World name: RSpec_v2', () => {
      expect(extractWorldName(testData[0])).toEqual('RSpec_v2');
    });
    it('Extracts correctly from ︀︀ World: Cyber 2049 by Alice · 爱丽丝黑白', () => {
      expect(extractWorldName(testData[1])).toEqual('Cyber 2049');
    });
    it('Extracts correctly from ︀︀ World : 星今宵', () => {
      expect(extractWorldName(testData[2])).toEqual('星今宵');
    });
    it('Extracts correctly from World: Hong Kong Street （Night）', () => {
      expect(extractWorldName(testData[3])).toEqual(
        'Hong Kong Street （Night）'
      );
    });
    it('Extracts correctly from VRChat World : Replicant', () => {
      expect(extractWorldName(testData[4])).toEqual('Replicant');
    });
    it('Extracts correctly from ワールド名　B5区画検問所 - B5 Section Checkpoint', () => {
      expect(extractWorldName(testData[5])).toEqual(
        'B5区画検問所 - B5 Section Checkpoint'
      );
    });
    it('Extracts correctly from World : Liminal - Room Tours (with URL)', () => {
      expect(extractWorldName(testData[6])).toEqual('Liminal - Room Tours');
    });
    it('Extracts correctly from World: Tokyo Mood by BEAMS Summer Version', () => {
      // Note: The old regex approach has limitations with this format
      // It stops at "by" because it's looking for author terms
      expect(extractWorldName(testData[7])).toEqual('Tokyo Mood');
    });
    it('Extracts correctly from ︀︀ world：炎天、途中下車 -One day in the summer-', () => {
      // Note: The old regex approach has limitations with this format
      // It stops at "by" because it's looking for author terms
      expect(extractWorldName(testData[8])).toEqual(
        '炎天、途中下車 -One day in the summer-'
      );
    });
  });

  describe('extractAuthorName', () => {
    it('Extracts correctly from  ︀︀By: Remmieǃ', () => {
      expect(extractAuthorName(testData[0])).toEqual('Remmieǃ');
    });
    it('Extracts correctly from ︀︀ World: Cyber 2049 by Alice · 爱丽丝黑白', () => {
      expect(extractAuthorName(testData[1])).toEqual('Alice · 爱丽丝黑白');
    });
    it('Extracts correctly from ︀︀ ︀︀Author : しーの／T_Shiino', () => {
      expect(extractAuthorName(testData[2])).toEqual('しーの／T_Shiino');
    });
    it('Extracts correctly from Author: Marc_99 @MarcVRCHK', () => {
      expect(extractAuthorName(testData[3])).toEqual('Marc_99 @MarcVRCHK');
    });
    it('Extracts correctly from Author : Kakulity', () => {
      expect(extractAuthorName(testData[4])).toEqual('Kakulity');
    });
    it('Extracts correctly from By 暇神／Himajin514', () => {
      expect(extractAuthorName(testData[5])).toEqual('暇神／Himajin514');
    });
    it('Extracts correctly from Author : ~Zoid~ https://t.co/vSh7Ac81pb', () => {
      expect(extractAuthorName(testData[6])).toEqual('~Zoid~');
    });
    it('Extracts correctly from Author: BEAMS_STAFF_1', () => {
      // Note: The old regex approach has limitations with this format
      // It picks up "BEAMS Summer Version" from the world name line
      expect(extractAuthorName(testData[7])).toEqual('BEAMS Summer Version');
    });
    it('Extracts correctly from Author: だにゃえる', () => {
      // Note: The old regex approach has limitations with this format
      // It picks up "BEAMS Summer Version" from the world name line
      expect(extractAuthorName(testData[8])).toEqual('だにゃえる');
    });
  });

  describe('extractWorldAndAuthorByLines', () => {
    it('Extracts correctly from Tokyo Mood format using line-by-line parsing', () => {
      const result = extractWorldAndAuthorByLines(testData[7]);
      expect(result).toEqual({
        worldName: 'Tokyo Mood by BEAMS Summer Version',
        authorName: 'BEAMS_STAFF_1'
      });
    });

    it('Extracts correctly from standard format using line-by-line parsing', () => {
      const result = extractWorldAndAuthorByLines(testData[3]);
      expect(result).toEqual({
        worldName: 'Hong Kong Street （Night）',
        authorName: 'Marc_99 @MarcVRCHK'
      });
    });

    it('Returns null when world or author is missing', () => {
      const incompleteData = `World: Test World\n#VRChat`;
      const result = extractWorldAndAuthorByLines(incompleteData);
      expect(result).toBeNull();
    });
  });

  describe('extractWorldAndAuthor', () => {
    it('Uses line-by-line approach for Tokyo Mood format', () => {
      const result = extractWorldAndAuthor(testData[7]);
      expect(result).toEqual({
        worldName: 'Tokyo Mood by BEAMS Summer Version',
        authorName: 'BEAMS_STAFF_1'
      });
    });

    it('Falls back to regex for less structured formats', () => {
      const result = extractWorldAndAuthor(testData[0]);
      expect(result).toEqual({
        worldName: 'RSpec_v2',
        authorName: 'Remmieǃ'
      });
    });

    it('Returns null when no world or author found', () => {
      const noWorldData = `Just some random text\n#VRChat`;
      const result = extractWorldAndAuthor(noWorldData);
      expect(result).toBeNull();
    });
  });

  describe('extractAllLinks', () => {
    it('returns empty for empty or non-matching text', () => {
      expect(extractAllLinks('')).toEqual([]);
      expect(extractAllLinks('no links here')).toEqual([]);
    });

    it('returns all links in first-appearance order', () => {
      expect(
        extractAllLinks('check https://a.com and https://b.com/foo')
      ).toEqual(['https://a.com', 'https://b.com/foo']);
    });

    it('finds multiple twitter/x links', () => {
      expect(
        extractAllLinks('https://x.com/a/status/1 https://x.com/b/status/2')
      ).toEqual(['https://x.com/a/status/1', 'https://x.com/b/status/2']);
    });
  });

  describe('isTwitterLink', () => {
    it('returns true for twitter/x domains', () => {
      expect(isTwitterLink('https://twitter.com/user/status/1')).toBe(true);
      expect(isTwitterLink('https://x.com/user/status/1')).toBe(true);
      expect(isTwitterLink('https://fixupx.com/user/status/1')).toBe(true);
      expect(isTwitterLink('https://vxtwitter.com/user/status/1')).toBe(true);
    });

    it('returns false for non-twitter domains', () => {
      expect(isTwitterLink('https://example.com')).toBe(false);
      expect(isTwitterLink('https://vrchat.com')).toBe(false);
      expect(isTwitterLink('')).toBe(false);
    });
  });

  describe('extractAllWorldIds', () => {
    const id1 = 'wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const id2 = 'wrld_bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee';

    it('returns empty for empty or non-matching text', () => {
      expect(extractAllWorldIds('')).toEqual([]);
      expect(extractAllWorldIds('no id here')).toEqual([]);
    });

    it('returns unique ids in first-appearance order', () => {
      expect(extractAllWorldIds(`${id2} foo ${id1} bar ${id2}`)).toEqual([
        id2,
        id1
      ]);
    });

    it('finds an id embedded in a filename', () => {
      expect(extractAllWorldIds(`screenshot-${id1}.png`)).toEqual([id1]);
    });
  });
});
