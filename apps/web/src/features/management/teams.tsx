'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useApplication } from '../application/provider';
import { useResource } from '../operations/resource';
import { Dialog, Lookup } from '../operations/forms';
import { type Page, type Ticket, date } from '../operations/model';
import { Empty, ErrorState, Loading, TicketTable } from '../operations/ui';
import { displayLabel } from '../../lib/presentation';
import { ResourceForm } from './forms';
import { useMutation } from './mutation';
import {
  type Team,
  type TeamMember,
  canManageOperations,
  listQuery,
} from './model';
import { PageHeading, Pager, Stats, Notice } from './ui';
export function Teams() {
  const { state } = useApplication();
  return <TeamList key={state.tenantRevision} />;
}
function TeamList() {
  const { state } = useApplication();
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [creating, setCreating] = useState(false),
    [saved, setSaved] = useState(false);
  const result = useResource<Page<Team>>(listQuery('/teams', search, page));
  return (
    <div className="operations">
      <PageHeading
        eyebrow="OPERASYONLAR / EKİPLER"
        title="Ekipler"
        description="Doğru kişileri bir araya getirin, ekiplerin iş yükünü görün."
        action={
          canManageOperations(state.session.selected?.role) && (
            <button
              className="primary-button"
              onClick={() => setCreating(true)}
            >
              Ekip Oluştur
            </button>
          )
        }
      />
      {saved && (
        <p className="management-success" role="status">
          Değişiklikler kaydedildi.
        </p>
      )}
      <Notice>
        İş yükü sayıları erişebildiğiniz talepleri kapsar. Aktif işler işlemdeki
        taleplerdir; çözüm bekleyenler terminal duruma ulaşmamış taleplerdir.
      </Notice>
      <section className="ops-panel">
        <div className="management-filters">
          <label>
            Ekiplerde ara
            <input
              type="search"
              maxLength={100}
              value={search}
              placeholder="Ekip adı"
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <span>{result.data?.pagination.total ?? '—'} ekip</span>
        </div>
        {result.error ? (
          <ErrorState
            entity="Ekip"
            error={result.error}
            retry={result.refresh}
          />
        ) : result.data?.data.length ? (
          <div className="team-card-grid">
            {result.data.data.map((team) => (
              <article className="team-card" key={team.id}>
                <header>
                  <span className="team-monogram" aria-hidden="true">
                    {team.name.slice(0, 1).toLocaleUpperCase('tr-TR')}
                  </span>
                  <div>
                    <h2>
                      <Link href={`/app/teams/${team.id}`}>{team.name}</Link>
                    </h2>
                    <p>{team.description ?? 'Operasyon ekibi'}</p>
                  </div>
                </header>
                <dl>
                  <div>
                    <dt>Üye</dt>
                    <dd>{team.memberCount}</dd>
                  </div>
                  <div>
                    <dt>Aktif İşler</dt>
                    <dd>{team.statistics.activeTickets}</dd>
                  </div>
                  <div>
                    <dt>Çözüm Bekleyen</dt>
                    <dd>{team.statistics.openTickets}</dd>
                  </div>
                </dl>
                <Link
                  className="team-detail-link"
                  href={`/app/teams/${team.id}`}
                >
                  Ekibi İncele →
                </Link>
              </article>
            ))}
          </div>
        ) : result.loading ? (
          <Loading />
        ) : (
          <Empty
            title={search ? 'Ekip bulunamadı' : 'Henüz ekip oluşturulmamış.'}
          >
            {search
              ? 'Farklı bir ekip adıyla tekrar arayın.'
              : 'Ekipler, talep atamalarını ve iş paylaşımını düzenler.'}
          </Empty>
        )}
        <Pager
          page={page}
          setPage={setPage}
          pagination={result.data?.pagination}
          loading={result.loading}
        />
      </section>
      {creating && (
        <ResourceForm
          kind="team"
          initial={null}
          close={() => setCreating(false)}
          refresh={result.refresh}
          done={() => {
            setCreating(false);
            setPage(1);
            setSearch('');
            setSaved(true);
            result.refresh();
          }}
        />
      )}
    </div>
  );
}
export function TeamDetail({ id }: { id: string }) {
  const { state } = useApplication();
  return <TeamRecord key={`${state.tenantRevision}:${id}`} id={id} />;
}
function MembershipDialog({
  team,
  removing,
  close,
  done,
  refresh,
}: {
  team: Team;
  removing: TeamMember | null;
  close: () => void;
  done: () => void;
  refresh: () => void;
}) {
  const [member, setMember] = useState<{ id: string; name: string } | null>(
      null,
    ),
    [localError, setLocalError] = useState('');
  const mutation = useMutation(refresh);
  return (
    <Dialog
      title={removing ? 'Üyeyi Ekipten Çıkar' : 'Üye Ekle'}
      close={close}
      busy={mutation.busy}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!removing && !member) {
            setLocalError('Bir üye seçin.');
            return;
          }
          void mutation.run(
            removing
              ? `/teams/${team.id}/members/${removing.membershipId}?expectedUpdatedAt=${encodeURIComponent(team.updatedAt)}`
              : `/teams/${team.id}/members`,
            removing
              ? { method: 'DELETE' }
              : {
                  method: 'POST',
                  body: {
                    membershipId: member!.id,
                    expectedUpdatedAt: team.updatedAt,
                  },
                },
            done,
          );
        }}
      >
        <fieldset disabled={mutation.busy}>
          {removing ? (
            <p>
              <strong>{removing.name}</strong> bu ekipten çıkarılacak. Kişinin
              çalışma alanı üyeliği korunur. Kişisel talep atamaları
              değiştirilmez; ekip üzerinden erişimi sonraki istekte yeniden
              değerlendirilir.
            </p>
          ) : (
            <>
              <p>
                Yalnızca bu çalışma alanının etkin üyeleri eklenebilir. Çalışma
                alanı rolü bu işlemle değişmez.
              </p>
              <Lookup
                label="Üye"
                path="/organization/members"
                value={member}
                onChange={setMember}
              />
            </>
          )}
        </fieldset>
        {(localError || mutation.error) && (
          <p className="inline-error" role="alert">
            {mutation.error || localError}
          </p>
        )}
        <footer className="dialog-actions">
          <button type="button" onClick={close} disabled={mutation.busy}>
            Vazgeç
          </button>
          <button
            className={removing ? 'danger-button' : 'primary-button'}
            disabled={mutation.busy}
          >
            {mutation.busy
              ? 'Kaydediliyor…'
              : removing
                ? 'Ekipten Çıkar'
                : 'Ekle'}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
function TeamRecord({ id }: { id: string }) {
  const { state } = useApplication();
  const result = useResource<Team>(`/teams/${id}`),
    [memberPage, setMemberPage] = useState(1),
    [ticketPage, setTicketPage] = useState(1),
    [memberSearch, setMemberSearch] = useState(''),
    [activeOnly, setActiveOnly] = useState(true),
    [editing, setEditing] = useState<Team | null>(null),
    [membership, setMembership] = useState<{
      team: Team;
      member: TeamMember | null;
    } | null>(null),
    [saved, setSaved] = useState(false);
  const members = useResource<Page<TeamMember>>(
    listQuery(`/teams/${id}/members`, memberSearch, memberPage),
  );
  const tickets = useResource<Page<Ticket>>(
    `/tickets?assignedTeamId=${id}&page=${ticketPage}&limit=20&sort=updatedAt:desc&activeOnly=${activeOnly}`,
  );
  const refresh = () => {
    result.refresh();
    members.refresh();
    tickets.refresh();
  };
  if (result.error)
    return (
      <ErrorState entity="Ekip" error={result.error} retry={result.refresh} />
    );
  if (!result.data) return <Loading />;
  const team = result.data,
    manage = canManageOperations(state.session.selected?.role);
  return (
    <div className="operations">
      <Link className="back-link" href="/app/teams">
        ← Ekipler
      </Link>
      <PageHeading
        eyebrow="EKİP / İŞ YÜKÜ"
        title={team.name}
        description={
          team.description ?? 'Üyeler ve ekip iş yükü tek görünümde.'
        }
        action={
          manage && (
            <div className="management-actions">
              <button onClick={() => setEditing(team)}>Düzenle</button>
              <button
                className="primary-button"
                onClick={() => setMembership({ team, member: null })}
              >
                Üye Ekle
              </button>
            </div>
          )
        }
      />
      {saved && (
        <p className="management-success" role="status">
          Değişiklikler kaydedildi.
        </p>
      )}
      <Stats statistics={team.statistics} team />
      <section className="ops-panel">
        <header className="panel-heading">
          <div>
            <h2>Ekip Üyeleri</h2>
            <p>
              {team.memberCount} üye · roller çalışma alanı üyeliğine aittir
            </p>
          </div>
          <button onClick={refresh}>Yenile</button>
        </header>
        <div className="management-filters">
          <label>
            Üyelerde ara
            <input
              type="search"
              maxLength={100}
              value={memberSearch}
              onChange={(event) => {
                setMemberSearch(event.target.value);
                setMemberPage(1);
              }}
            />
          </label>
        </div>
        {members.error ? (
          <ErrorState
            entity="Üye"
            error={members.error}
            retry={members.refresh}
          />
        ) : members.data?.data.length ? (
          <ul className="team-member-list">
            {members.data.data.map((member) => (
              <li key={member.membershipId}>
                <span className="member-avatar" aria-hidden="true">
                  {member.name.slice(0, 1).toLocaleUpperCase('tr-TR')}
                </span>
                <div>
                  <strong>{member.name}</strong>
                  <span>
                    {displayLabel(member.role)} ·{' '}
                    {member.isActive ? 'Etkin hesap' : 'Etkin olmayan hesap'}
                  </span>
                  <small>Katılım: {date(member.createdAt)}</small>
                </div>
                {manage && (
                  <button
                    className="danger-button"
                    aria-label={`${member.name} kişisini ekipten çıkar`}
                    onClick={() => setMembership({ team, member })}
                  >
                    Çıkar
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : members.loading ? (
          <Loading />
        ) : (
          <Empty
            title={memberSearch ? 'Üye bulunamadı' : 'Bu ekipte henüz üye yok'}
          >
            {memberSearch
              ? 'Başka bir adla aramayı deneyin.'
              : 'Ekip üyeleri eklendiğinde burada listelenecek.'}
          </Empty>
        )}
        <Pager
          page={memberPage}
          setPage={setMemberPage}
          pagination={members.data?.pagination}
          loading={members.loading}
        />
      </section>
      <section className="ops-panel">
        <header className="panel-heading">
          <div>
            <h2>Atanan Talepler</h2>
            <p>Erişebildiğiniz ekip talepleri</p>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(event) => {
                setActiveOnly(event.target.checked);
                setTicketPage(1);
              }}
            />
            Yalnızca çözüm bekleyenler
          </label>
        </header>
        {tickets.error ? (
          <ErrorState error={tickets.error} retry={tickets.refresh} />
        ) : tickets.data?.data.length ? (
          <TicketTable tickets={tickets.data.data} />
        ) : tickets.loading ? (
          <Loading />
        ) : (
          <Empty title="Bu görünümde talep yok">
            Bu ekibe atanmış ve erişebildiğiniz talepler burada görünecek.
          </Empty>
        )}
        <Pager
          page={ticketPage}
          setPage={setTicketPage}
          pagination={tickets.data?.pagination}
          loading={tickets.loading}
        />
      </section>
      {editing && (
        <ResourceForm
          kind="team"
          initial={editing}
          close={() => setEditing(null)}
          refresh={refresh}
          done={() => {
            setEditing(null);
            setSaved(true);
            refresh();
          }}
        />
      )}
      {membership && (
        <MembershipDialog
          team={membership.team}
          removing={membership.member}
          close={() => setMembership(null)}
          refresh={refresh}
          done={() => {
            setMembership(null);
            setMemberPage(1);
            setMemberSearch('');
            setSaved(true);
            refresh();
          }}
        />
      )}
    </div>
  );
}
