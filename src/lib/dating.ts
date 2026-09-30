export type DatingGender = 'male' | 'female';
export type DatingPreference = 'any' | DatingGender;

export type DatingProfileDraft = {
  displayName: string;
  city: string;
  bio: string;
  preferredGender: DatingPreference;
  minAge: number;
  maxAge: number;
  isActive: boolean;
};

export type DatingProfile = DatingProfileDraft & {
  id: string;
  image: string;
  age: number;
  gender: DatingGender;
  country: string;
  consentedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type DatingProfileSummary = Pick<DatingProfile,
  'id' | 'displayName' | 'image' | 'age' | 'gender' | 'country' | 'city' | 'bio'
>;

export type DatingInterest = {
  id: string;
  fromId: string;
  toId: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
  updatedAt: string;
};

type DatingCompatibilityProfile = Pick<DatingProfile, 'id' | 'age' | 'gender' | 'preferredGender' | 'minAge' | 'maxAge' | 'isActive'>;
const datingContactInfoPattern = /(?:https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[A-Z]{2,}|(?:\+?\d[\d\s().-]{7,}\d)|카카오톡|카톡|텔레그램|telegram|whatsapp|discord|wechat|위챗|인스타|instagram|연락처|아이디|주소|우편번호|zip\s*code)/i;

export function hasDatingContactInfo(value: string): boolean {
  return datingContactInfoPattern.test(value);
}

export function validateDatingProfileDraft(
  draft: DatingProfileDraft,
  account: { age?: number; gender?: string; country?: string },
): string | null {
  if (!Number.isInteger(account.age) || (account.age || 0) < 18 || (account.age || 0) > 130) return '데이트 기능은 만 18세 이상 회원만 이용할 수 있습니다.';
  if (account.gender !== 'male' && account.gender !== 'female') return '회원 프로필의 성별 정보를 확인해주세요.';
  if (!account.country?.trim() || account.country.trim() === 'Global') return '먼저 회원 프로필의 국가를 설정해주세요.';
  if (!draft.displayName.trim() || draft.displayName.trim().length > 80) return '표시 이름은 1~80자로 입력해주세요.';
  if (draft.city.trim().length > 80) return '도시 이름은 80자 이내로 입력해주세요.';
  if (draft.bio.trim().length > 280) return '자기소개는 280자 이내로 입력해주세요.';
  if (!['any', 'male', 'female'].includes(draft.preferredGender)) return '희망 상대 정보를 확인해주세요.';
  if (!Number.isInteger(draft.minAge) || !Number.isInteger(draft.maxAge)
    || draft.minAge < 18 || draft.maxAge > 130 || draft.minAge > draft.maxAge) {
    return '희망 연령은 만 18세 이상, 최대 130세 범위에서 선택해주세요.';
  }
  if (typeof draft.isActive !== 'boolean') return '프로필 공개 설정을 확인해주세요.';

  if (hasDatingContactInfo(draft.displayName.trim())) return '표시 이름에는 연락처나 외부 링크를 적을 수 없습니다.';
  if (hasDatingContactInfo(draft.city.trim())) return '도시 이름에는 정확한 주소나 연락처를 적을 수 없습니다.';
  if (hasDatingContactInfo(draft.bio.trim())) return '자기소개에는 외부 링크나 연락처를 적을 수 없습니다.';
  return null;
}

export function areDatingProfilesCompatible(viewer: DatingCompatibilityProfile, candidate: DatingCompatibilityProfile): boolean {
  if (!viewer.isActive || !candidate.isActive || viewer.id === candidate.id) return false;
  if (candidate.age < viewer.minAge || candidate.age > viewer.maxAge) return false;
  if (viewer.age < candidate.minAge || viewer.age > candidate.maxAge) return false;
  if (viewer.preferredGender !== 'any' && viewer.preferredGender !== candidate.gender) return false;
  return candidate.preferredGender === 'any' || candidate.preferredGender === viewer.gender;
}

export function datingInterestDocumentId(fromId: string, toId: string): string {
  if (!fromId || !toId || fromId === toId || /[\/]/.test(fromId) || /[\/]/.test(toId)) {
    throw new Error('관심 요청 대상을 확인해주세요.');
  }
  const sourceBytes = new TextEncoder().encode(fromId).length;
  return `${sourceBytes}_${fromId}_${toId}`;
}
