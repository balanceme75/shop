-- =====================================================================
-- 초록마트 : [5] 재고 + 상품 50종 추가 + 이미지 출처/라이선스 기록
--   이미지는 Wikimedia Commons 의 PD / CC0 / CC BY(-SA) 자료만 사용
-- =====================================================================

-- ---------- 재고 및 이미지 출처 컬럼 ----------
alter table public.products add column if not exists stock       int  not null default 100;
alter table public.products add column if not exists img_license text;
alter table public.products add column if not exists img_author  text;
alter table public.products add column if not exists img_source  text;

alter table public.products add constraint products_stock_nonneg check (stock >= 0) not valid;
alter table public.products validate constraint products_stock_nonneg;

-- 기존 8개 상품 재고 100개로 설정
update public.products set stock = 100 where stock is distinct from 100;

-- id 자동 증가용 시퀀스 (지금까지는 수동 부여였음)
create sequence if not exists public.products_id_seq owned by public.products.id;
alter table public.products alter column id set default nextval('public.products_id_seq');

-- ---------- 상품 50종 추가 ----------
insert into public.products
  (id, name, category, price, discount, description, img, badge, stock,
   img_license, img_author, img_source)
values
  (9, '테라코타 미니 화분 10cm', '화분', 5000, 10, '통기성이 좋은 토분. 다육이·허브 등 소형 식물에 알맞은 기본 사이즈입니다.', 'img/p09.jpg', '베스트', 100, 'Public domain', 'Lombroso', 'https://commons.wikimedia.org/wiki/File:Flowerpot_1.jpg'),
  (10, '테라코타 화분 15cm', '화분', 7000, 15, '배수구와 받침 턱이 있어 과습을 막아주는 중형 토분입니다.', 'img/p10.jpg', NULL, 100, 'Public domain', 'Lombroso', 'https://commons.wikimedia.org/wiki/File:Flowerpot_2.jpg'),
  (11, '테라코타 대형 화분 20cm', '화분', 9500, 20, '관엽식물용 대형 토분. 두께가 있어 뿌리 온도를 안정적으로 지켜줍니다.', 'img/p11.jpg', '인기', 100, 'CC0', 'Philafrenzy', 'https://commons.wikimedia.org/wiki/File:Pots_at_a_garden_centre.jpg'),
  (12, '이중 배수 플라스틱 화분', '화분', 3500, 5, '가볍고 튼튼한 이중 배수 구조. 물받침이 일체형이라 실내에서도 깔끔합니다.', 'img/p12.jpg', NULL, 100, 'CC BY-SA 4.0', 'Secretlondon', 'https://commons.wikimedia.org/wiki/File:Plastic_nursery_plant_pot_2022.jpg'),
  (13, '블랙 세라믹 화분', '화분', 12000, 10, '무광 블랙 도자기 화분. 어떤 인테리어에도 잘 어울리는 기본형입니다.', 'img/p13.jpg', NULL, 100, 'CC0', 'Lowoxay68', 'https://commons.wikimedia.org/wiki/File:Charming_outdoor_display_of_succulent_plants_in_vintage_pots.jpg'),
  (14, '무광 세라믹 화분 2P 세트', '화분', 19000, 15, '크기가 다른 세라믹 화분 2개 세트. 책상·선반 연출에 좋습니다.', 'img/p14.jpg', '추천', 100, 'CC0', 'Alvin Engler englr', 'https://commons.wikimedia.org/wiki/File:Succulent_office_plants_(Unsplash).jpg'),
  (15, '행잉 플랜터 화이트', '화분', 14000, 20, '천장·창가에 거는 매달이 화분. 마크라메 끈이 포함되어 있습니다.', 'img/p15.jpg', '신상', 100, 'Public domain', 'Andrew C. Murdoch (BlueSquadronRaven)', 'https://commons.wikimedia.org/wiki/File:HangingBasketSunflower.jpg'),
  (16, '야외용 행잉 바스켓', '화분', 16000, 10, '베란다·현관에 거는 대형 바스켓. 코코넛 섬유 내피가 들어 있습니다.', 'img/p16.jpg', NULL, 100, 'CC BY-SA 4.0', 'Chris Woodrich', 'https://commons.wikimedia.org/wiki/File:Hanging_flower_basket,_Essex,_Ontario,_2025-08-30_01.jpg'),
  (17, '야외 대형 플랜터 박스', '화분', 28000, 25, '현관·정원용 대형 플랜터. 여러 포기를 한 번에 심을 수 있습니다.', 'img/p17.jpg', NULL, 100, 'CC BY-SA 4.0', 'Valeria Delgado', 'https://commons.wikimedia.org/wiki/File:Árbol_bonsai_y_flores_rosas_en_el_mercado_de_plantas.jpg'),
  (18, '벽걸이 미니 화분 세트', '화분', 11000, 10, '벽에 걸어 쓰는 소형 화분 세트. 공간을 적게 차지합니다.', 'img/p18.jpg', NULL, 100, 'CC BY-SA 4.0', 'Steffen Mokosch', 'https://commons.wikimedia.org/wiki/File:Hanging_terracotta_flower_pots_with_succulents_Arta_Mallorca.jpg'),
  (19, '모종 포트 50개입', '화분', 6000, 5, '씨앗 파종·모종 옮겨심기용 소형 포트. 넉넉한 50개 구성입니다.', 'img/p19.jpg', NULL, 100, 'Public domain', 'user:Fdmfi', 'https://commons.wikimedia.org/wiki/File:Cactus_Greenhouses_in_Mahallat.JPG'),
  (20, '허브 전용 장방형 화분', '화분', 13000, 15, '창가 폭에 맞춘 긴 화분. 바질·민트 등 허브를 여러 종 함께 키울 수 있습니다.', 'img/p20.jpg', NULL, 100, 'CC BY-SA 2.0', 'daryl_mitchell from Saskatoon, Saskatchewan, Canada', 'https://commons.wikimedia.org/wiki/File:Herb_Containers_2012_-_June_(7399952806).jpg'),
  (21, '소나무 미니 분재', '반려식물', 45000, 15, '수형을 잡아 기른 실내용 미니 분재. 받침 화분이 함께 제공됩니다.', 'img/p21.jpg', '베스트', 100, 'CC BY-SA 2.0', 'Laura Blanchard from Philadelphia, USA', 'https://commons.wikimedia.org/wiki/File:2016-03-10_0082n_pabonsai_(28007593041).jpg'),
  (22, '대형 향나무 분재', '반려식물', 120000, 10, '10년 이상 수형을 다듬은 대형 분재. 현관·사무실 상징목으로 좋습니다.', 'img/p22.jpg', NULL, 100, 'CC BY-SA 3.0', 'Lijo p James', 'https://commons.wikimedia.org/wiki/File:Bonsai_mysore.jpg'),
  (23, '알로에 다육이', '반려식물', 8000, 10, '물을 자주 주지 않아도 되는 대표 다육식물. 초보자에게 가장 추천합니다.', 'img/p23.jpg', '인기', 100, 'CC BY 3.0', 'PEAK99', 'https://commons.wikimedia.org/wiki/File:Cactus_plants_of_Thailand_(80).jpg'),
  (24, '에케베리아 다육이', '반려식물', 9000, 20, '장미 모양으로 잎이 겹쳐 자라는 인기 다육이입니다.', 'img/p24.jpg', NULL, 100, 'CC BY 3.0', 'PEAK99', 'https://commons.wikimedia.org/wiki/File:Cactus_plants_of_Thailand_(81).jpg'),
  (25, '다육이 모둠 5종 세트', '반려식물', 25000, 25, '서로 다른 다육식물 5종을 한 번에. 선물용으로 많이 찾으시는 구성입니다.', 'img/p25.jpg', '추천', 100, 'CC0', 'Milada Vigerova mili_vigerova', 'https://commons.wikimedia.org/wiki/File:Potted_succulents_in_window_(Unsplash).jpg'),
  (26, '기둥 선인장', '반려식물', 15000, 10, '위로 곧게 자라는 기둥형 선인장. 관리가 매우 쉽습니다.', 'img/p26.jpg', NULL, 100, 'CC BY 3.0', 'PEAK99', 'https://commons.wikimedia.org/wiki/File:Cactus_(32).jpg'),
  (27, '호접란 핑크', '반려식물', 38000, 15, '개업·집들이 선물 1위. 분홍 꽃대가 2개월 이상 유지됩니다.', 'img/p27.jpg', '베스트', 100, 'CC BY-SA 4.0', 'George E. Koronaios', 'https://commons.wikimedia.org/wiki/File:Pink_orchid_in_a_white_pot.jpg'),
  (28, '호접란 3대 화이트포트', '반려식물', 52000, 20, '꽃대 3대의 풍성한 구성. 화이트 도자기 화분에 심어 발송합니다.', 'img/p28.jpg', NULL, 100, 'CC BY-SA 3.0', 'Timm Schoof', 'https://commons.wikimedia.org/wiki/File:Pot_Orchid_(124213019).jpeg'),
  (29, '미니 호접란 화이트', '반려식물', 29000, 10, '책상 위에 올릴 수 있는 소형 호접란입니다.', 'img/p29.jpg', NULL, 100, 'CC BY-SA 3.0', 'Francois Polito', 'https://commons.wikimedia.org/wiki/File:Orchid_in_pot.jpg'),
  (30, '실내용 호접란 다크포트', '반려식물', 33000, 15, '어두운 톤 화분과 매치한 실내 연출용 호접란입니다.', 'img/p30.jpg', NULL, 100, 'CC BY-SA 4.0', 'George E. Koronaios', 'https://commons.wikimedia.org/wiki/File:Purple_and_white_orchid_in_a_black_pot.jpg'),
  (31, '산세베리아 중형', '반려식물', 22000, 10, '공기정화 식물의 대표. 음지에서도 잘 자라 관리가 쉽습니다.', 'img/p31.jpg', '인기', 100, 'CC0', 'Krishnav25', 'https://commons.wikimedia.org/wiki/File:Snake_plant_(Sansevieria_trifasciata).jpg'),
  (32, '산세베리아 골드', '반려식물', 24000, 15, '잎 가장자리에 노란 무늬가 들어간 품종입니다.', 'img/p32.jpg', NULL, 100, 'CC0', 'David E Mead', 'https://commons.wikimedia.org/wiki/File:Snake_plant_(Sansevieria_trifasciata)_Waoleona_Buton_Island_03.jpg'),
  (33, '산세베리아 대형', '반려식물', 35000, 20, '높이 70cm 내외의 대형 개체. 거실 코너용으로 좋습니다.', 'img/p33.jpg', NULL, 100, 'CC0', 'David E Mead', 'https://commons.wikimedia.org/wiki/File:Snake_plant_(Sansevieria_trifasciata)_Waoleona_Buton_Island_02.jpg'),
  (34, '산세베리아 미니', '반려식물', 13000, 5, '작은 화분에 심은 미니 사이즈. 책상·화장실에 적합합니다.', 'img/p34.jpg', NULL, 100, 'CC0', '999real', 'https://commons.wikimedia.org/wiki/File:Snake_plant_Sansevieria_growing_in_a_pot_portrait.jpg'),
  (35, '몬스테라 실버', '반려식물', 27000, 15, '은빛 무늬가 들어간 몬스테라. 덩굴성으로 지지대와 함께 키웁니다.', 'img/p35.jpg', '신상', 100, 'CC BY 2.0', 'Dan Jones', 'https://commons.wikimedia.org/wiki/File:Monstera_siltepecana_(Silver_Monstera)_Tropical_Houseplant.jpg'),
  (36, '로즈마리 허브 화분', '반려식물', 11000, 10, '향이 좋은 로즈마리. 요리에 바로 잘라 쓸 수 있습니다.', 'img/p36.jpg', NULL, 100, 'CC0', 'freestocks.org freestocks', 'https://commons.wikimedia.org/wiki/File:Olsztyn_succulent_(Unsplash).jpg'),
  (37, '해바라기 씨앗 (줄무늬)', '씨앗', 3500, 10, '키 2m까지 자라는 대형 해바라기 품종. 발아율 92% 이상입니다.', 'img/p37.jpg', NULL, 100, 'CC0', 'Mx. Granger', 'https://commons.wikimedia.org/wiki/File:Guazi_(sunflower_seeds).jpg'),
  (38, '흰해바라기 씨앗', '씨앗', 4000, 15, '껍질이 흰 희귀 품종. 관상용으로 인기가 많습니다.', 'img/p38.jpg', NULL, 100, 'CC BY-SA 4.0', 'Dmitry Makeev', 'https://commons.wikimedia.org/wiki/File:Sunflower_seeds_-_white._img_03.jpg'),
  (39, '흑종 해바라기 씨앗', '씨앗', 3800, 10, '짙은 색 씨앗의 유지용 품종. 새 모이로도 활용됩니다.', 'img/p39.jpg', NULL, 100, 'CC BY-SA 4.0', 'Dmitry Makeev', 'https://commons.wikimedia.org/wiki/File:Sunflower_seeds._img_006.jpg'),
  (40, '방울토마토 씨앗 대용량', '씨앗', 4500, 20, '베란다에서도 잘 열리는 방울토마토. 약 200립이 들어 있습니다.', 'img/p40.jpg', '인기', 100, 'CC BY-SA 3.0', 'Vmenkov', 'https://commons.wikimedia.org/wiki/File:Seattle-Heirloom-tomato-2155.jpg'),
  (41, '토마토 모종 3포트', '씨앗', 9000, 10, '이미 발아시킨 토마토 모종 3포트. 바로 옮겨 심으면 됩니다.', 'img/p41.jpg', NULL, 100, 'CC0', 'Tomwsulcer', 'https://commons.wikimedia.org/wiki/File:Tomato_plants_grown_from_seeds_near_window.JPG'),
  (42, '야생화 혼합 씨앗', '씨앗', 3000, 5, '여러 야생화를 섞은 혼합 씨앗. 화단에 뿌리기만 하면 됩니다.', 'img/p42.jpg', NULL, 100, 'Public domain', 'ShenandoahNPS', 'https://commons.wikimedia.org/wiki/File:Milkweed_Seed_Macro_(51862706170).jpg'),
  (43, '무스카리 구근 씨앗', '씨앗', 6500, 15, '봄에 보라색 꽃을 피우는 구근. 가을에 심어 두면 됩니다.', 'img/p43.jpg', NULL, 100, 'CC0', 'DKDEVS', 'https://commons.wikimedia.org/wiki/File:A_beautiful_plant_seeds.jpg'),
  (44, '에키네시아 씨앗', '씨앗', 3200, 10, '여름 내내 꽃이 피는 숙근초. 한 번 심으면 매년 올라옵니다.', 'img/p44.jpg', NULL, 100, 'Public domain', 'Joshua Tree National Park', 'https://commons.wikimedia.org/wiki/File:Plant_gone_to_seed_(52027283609).jpg'),
  (45, '민들레 씨앗', '씨앗', 2500, 5, '아이와 함께 키우기 좋은 관찰용 씨앗입니다.', 'img/p45.jpg', NULL, 100, 'Public domain', 'ShenandoahNPS', 'https://commons.wikimedia.org/wiki/File:Milkweed_Seed_Macro_(51855248219).jpg'),
  (46, '라벤더 씨앗 (앙구스티폴리아)', '씨앗', 4200, 20, '향이 가장 진한 잉글리시 라벤더 품종의 씨앗입니다.', 'img/p46.jpg', '추천', 100, 'Public domain', 'Franz Eugen Köhler, Köhler''s Medizinal-Pflanzen', 'https://commons.wikimedia.org/wiki/File:Lavandula_angustifolia_-_Köhler–s_Medizinal-Pflanzen-087.jpg'),
  (47, '양파 씨앗 빈티지 에디션', '씨앗', 3000, 10, '가정용 텃밭에 알맞은 중만생종 양파 씨앗입니다.', 'img/p47.jpg', NULL, 100, 'No restrictions', 'W. Atlee Burpee Company; Henry G. Gilbert Nursery and Seed Trade Catalog Collect', 'https://commons.wikimedia.org/wiki/File:Burpee''s farm annual - garden, farm, and flower seeds (1886) (20483979796).jpg'),
  (48, '한련화 씨앗 믹스', '씨앗', 3600, 15, '잎과 꽃을 모두 먹을 수 있는 식용 꽃. 색상 혼합 구성입니다.', 'img/p48.jpg', NULL, 100, 'No restrictions', 'Internet Archive Book Images', 'https://commons.wikimedia.org/wiki/File:Choice_flower_seeds_(1901)_(20422985099).jpg'),
  (49, '분갈이 전용 배양토 5L', '흙', 9000, 10, '바로 쓸 수 있도록 배합을 끝낸 분갈이용 배양토입니다.', 'img/p49.jpg', '베스트', 100, 'CC BY-SA 2.0', 'peganum from Henfield, England', 'https://commons.wikimedia.org/wiki/File:Why_I_hate_peat-based_composts_(9491832797).jpg'),
  (50, '펄라이트 2L', '흙', 5000, 15, '배수성과 통기성을 높여 주는 다공질 광물. 배양토에 섞어 쓰세요.', 'img/p50.jpg', NULL, 100, 'CC BY-SA 3.0', 'Ragesoss', 'https://commons.wikimedia.org/wiki/File:Schultz_Horticultural_Perlite.jpg'),
  (51, '피트모스 10L', '흙', 14000, 20, '보수력이 뛰어난 유기질 토양 개량제. 파종·삽목에 적합합니다.', 'img/p51.jpg', NULL, 100, 'CC0', 'no rights reserved', 'https://commons.wikimedia.org/wiki/File:Blushing_Peat_Moss_iNaturalist.jpg'),
  (52, '수태(스파그넘) 500g', '흙', 8000, 10, '난·착생식물용 수태. 물을 머금어 뿌리 건조를 막아 줍니다.', 'img/p52.jpg', NULL, 100, 'CC BY-SA 4.0', 'Agnieszka Kwiecień, Nova', 'https://commons.wikimedia.org/wiki/File:Sphagnum_sp._Torfowiec_2023-11-01_Borowa_02.jpg'),
  (53, '마사토 5kg', '흙', 7000, 5, '화분 바닥에 깔아 배수층을 만드는 굵은 모래입니다.', 'img/p53.jpg', NULL, 100, 'CC0', 'Judgefloro', 'https://commons.wikimedia.org/wiki/File:5620Farm_Ready_Seedling_Facility_East_West_Seed_Philippines_21.jpg'),
  (54, '메탈 물뿌리개 1.5L', '원예용품', 18000, 15, '녹슬지 않는 아연 도금 물뿌리개. 샤워 헤드가 분리됩니다.', 'img/p54.jpg', '추천', 100, 'CC0', 'Benjamin Balázs from Hungary', 'https://commons.wikimedia.org/wiki/File:Watering_can_(14811313052).jpg'),
  (55, '실내용 미니 물뿌리개', '원예용품', 9500, 10, '좁은 화분 사이에도 들어가는 긴 주둥이 소형 물뿌리개입니다.', 'img/p55.jpg', NULL, 100, 'Public domain', 'WayneRay', 'https://commons.wikimedia.org/wiki/File:Metal_Watering_Can.jpg'),
  (56, '육묘 트레이 128공', '원예용품', 7500, 5, '씨앗을 한 번에 128립 파종할 수 있는 트레이입니다.', 'img/p56.jpg', NULL, 100, 'CC0', 'Judgefloro', 'https://commons.wikimedia.org/wiki/File:5620Farm_Ready_Seedling_Facility_East_West_Seed_Philippines_35.jpg'),
  (57, '대형 육묘 베드 트레이', '원예용품', 22000, 20, '다량 파종용 대형 베드. 농가·동호회용으로 적합합니다.', 'img/p57.jpg', NULL, 100, 'CC0', 'Judgefloro', 'https://commons.wikimedia.org/wiki/File:5720Farm_Ready_Seedling_Facility_East_West_Seed_Philippines_27.jpg'),
  (58, '생분해 육묘 포트 100입', '원예용품', 12000, 10, '그대로 땅에 심으면 분해되는 친환경 포트. 뿌리 손상이 없습니다.', 'img/p58.jpg', '신상', 100, 'CC0', 'Judgefloro', 'https://commons.wikimedia.org/wiki/File:5904Farm_Ready_Seedling_Facility_East_West_Seed_Philippines_11.jpg')
on conflict (id) do update set
  name        = excluded.name,
  category    = excluded.category,
  price       = excluded.price,
  discount    = excluded.discount,
  description = excluded.description,
  img         = excluded.img,
  badge       = excluded.badge,
  stock       = excluded.stock,
  img_license = excluded.img_license,
  img_author  = excluded.img_author,
  img_source  = excluded.img_source;

-- 시퀀스를 현재 최대 id 뒤로 맞춤
select setval('public.products_id_seq', (select max(id) from public.products));

select count(*) as total_products,
       count(*) filter (where stock = 100) as stock_100,
       count(distinct category) as categories
  from public.products;
