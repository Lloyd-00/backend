import { useEffect, useMemo, useState } from "react";
import "../stylesheet/Announcements.css";
import MessageCard from "../components/MessageCard";
import FormAnnouncementModal from "../components/FormAnnouncementModal";
import SendModal from "../components/SendModal";
import { supabase } from "../lib/supabase";
import { OrganizationFilter, getFilterIds } from "./Dashboard";

function Announcements({ profile, memberships = [], canManage = false }) {
    const [showForm, setShowForm] = useState(false);
    const [messages, setMessages] = useState([]);
    const [title, setTitle] = useState("");
    const [input, setInput] = useState("");
    const [showSendModal, setShowSendModal] = useState(false);
    const [selectedMessage, setSelectedMessage] = useState(null);
    const [users, setUsers] = useState([]);
    const [groups, setGroups] = useState([]);
    const [organizationFilter, setOrganizationFilter] = useState("default");
    const [sendQueue, setSendQueue] = useState([]);
    const [queueExpanded, setQueueExpanded] = useState(true);

    const selectedIds = useMemo(
        () => getFilterIds(organizationFilter, profile, memberships),
        [organizationFilter, profile, memberships]
    );

    const loadAnnouncements = async () => {
        if (selectedIds.length === 0) {
            setMessages([]);
            return;
        }

        const query = supabase
            .from("announcements")
            .select("*, organizations(name)")
            .order("created_at", { ascending: false });

        const { data, error } =
            selectedIds.length === 1
                ? await query.eq("organization_id", selectedIds[0])
                : await query.in("organization_id", selectedIds);

        if (error) console.error(error);
        setMessages(data || []);
    };

    useEffect(() => {
        loadAnnouncements();
    }, [selectedIds.join("|")]);

    useEffect(() => {
        const fetchTargets = async () => {
            if (!profile?.organization_id || !canManage) return;

            const [{ data: userData }, { data: groupData }] = await Promise.all([
                supabase
                    .from("profiles")
                    .select("*")
                    .eq("organization_id", profile.organization_id),
                supabase
                    .from("groups")
                    .select("*")
                    .eq("organization_id", profile.organization_id)
            ]);

            setUsers(userData || []);
            setGroups(groupData || []);
        };

        fetchTargets();
    }, [profile?.organization_id, canManage]);

    const addMessage = async () => {
        if (!title.trim() || !input.trim() || !profile?.organization_id) return;

        const { error } = await supabase
            .from("announcements")
            .insert([{
                title: title.trim(),
                content: input.trim(),
                organization_id: profile.organization_id
            }]);

        if (error) {
            console.error(error);
            return alert("Failed to create announcement");
        }

        setTitle("");
        setInput("");
        await loadAnnouncements();
    };

    const deleteMessage = async (id) => {
        const { error } = await supabase
            .from("announcements")
            .delete()
            .eq("id", id);

        if (error) {
            console.error(error);
            return alert("Failed to delete announcement");
        }

        setMessages((prev) => prev.filter((message) => message.id !== id));
    };

    const getRequestedCounts = (channel, selectedUsers) => ({
        email:
            channel === "email" || channel === "both"
                ? selectedUsers.filter((user) => user.email).length
                : 0,
        sms:
            channel === "sms" || channel === "both"
                ? selectedUsers.filter((user) => user.mobile).length
                : 0
    });

    const updateQueueItem = (id, updates) => {
        setSendQueue((prev) =>
            prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
        );
    };

    const queueAnnouncementSend = ({ channel, users: selectedUsers }) => {
        if (!selectedMessage) return;

        const id = `${selectedMessage.id}-${Date.now()}`;
        const requested = getRequestedCounts(channel, selectedUsers);
        const queueItem = {
            id,
            title: selectedMessage.title,
            channel,
            status: "queued",
            totalUsers: selectedUsers.length,
            requested,
            sent: { email: 0, sms: 0 },
            errors: [],
            createdAt: new Date().toISOString()
        };

        setSendQueue((prev) => [queueItem, ...prev].slice(0, 10));

        window.setTimeout(async () => {
            updateQueueItem(id, { status: "sending" });

            const backendBase = import.meta.env.VITE_BACKEND_URL?.trim() || "";
            const sendUrl = backendBase
                ? `${backendBase.replace(/\/$/, "")}/send-notification`
                : "/send-notification";

            try {
                const res = await fetch(sendUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                    },
                    body: JSON.stringify({
                        channel,
                        users: selectedUsers.map((user) => ({
                            email: user.email,
                            mobile: user.mobile,
                            name: user.username || user.name || user.email,
                        })),
                        message: {
                            title: selectedMessage.title,
                            content: selectedMessage.content,
                        },
                    }),
                });

                const responseText = await res.text();
                let data = {};
                try {
                    data = responseText ? JSON.parse(responseText) : {};
                } catch {
                    data = { error: responseText };
                }

                if (!res.ok) throw new Error(data.error || responseText || "Failed to send");

                const results = data.results || [];
                const sent = {
                    email: results.filter((result) => result.emailStatus === "sent").length,
                    sms: results.filter((result) => result.smsStatus === "sent").length
                };
                const errors = results
                    .filter((result) => result.smsStatus === "failed" && result.smsError)
                    .slice(0, 3)
                    .map((result) => result.smsError);
                const requestedTotal = requested.email + requested.sms;
                const sentTotal = sent.email + sent.sms;

                updateQueueItem(id, {
                    status: requestedTotal > 0 && sentTotal === requestedTotal
                        ? "successful"
                        : "partially successful",
                    sent,
                    errors
                });
            } catch (err) {
                console.error(err);
                updateQueueItem(id, {
                    status: "partially successful",
                    errors: [err.message || "Notification request failed"]
                });
            }
        }, 250);
    };

    const queueStatusLabel = (status) =>
        status.charAt(0).toUpperCase() + status.slice(1);

    return (
        <div className="general" id="announcements">
            <div className="titleHead">
                <h1 className="title">Announcements</h1>
                <OrganizationFilter
                    value={organizationFilter}
                    onChange={setOrganizationFilter}
                    memberships={memberships}
                />
                {canManage && (
                    <button
                        className="general-button"
                        style={{ marginTop: "auto", marginBottom: "30px", marginRight: "10px" }}
                        onClick={() => setShowForm(true)}
                    >
                        + Create Announcement
                    </button>
                )}
            </div>

            <div className={`announcementWorkspace ${queueExpanded ? "queueOpen" : "queueClosed"}`}>
                <div className="cardContainer announcementList">
                    {messages.length === 0 && (
                        <div className="card">
                            <p>No announcements yet.</p>
                        </div>
                    )}
                    {messages.map((msg) => (
                        <MessageCard
                            key={msg.id}
                            text={{
                                ...msg,
                                title:
                                    organizationFilter === "all" && msg.organizations?.name
                                        ? `${msg.organizations.name}: ${msg.title}`
                                        : msg.title
                            }}
                            onDelete={canManage ? () => deleteMessage(msg.id) : null}
                            onSend={
                                canManage
                                    ? () => {
                                        setSelectedMessage(msg);
                                        setShowSendModal(true);
                                    }
                                    : null
                            }
                        />
                    ))}
                </div>

                {canManage && (
                    <aside className="sendQueueSidebar">
                        <button
                            className="queueToggle"
                            type="button"
                            onClick={() => setQueueExpanded((expanded) => !expanded)}
                            aria-label={queueExpanded ? "Hide send queue" : "Show send queue"}
                        >
                            {queueExpanded ? ">" : "<"}
                        </button>

                        {queueExpanded && (
                            <>
                                <h3>Send Queue</h3>
                                {sendQueue.length === 0 ? (
                                    <p className="queueEmpty">No queued actions yet.</p>
                                ) : (
                                    <div className="queueList">
                                        {sendQueue.slice(0, 10).map((item) => (
                                            <div className="queueItem" key={item.id}>
                                                <div className="queueHeader">
                                                    <strong>{item.title}</strong>
                                                    <span className={`queueStatus ${item.status.replace(" ", "-")}`}>
                                                        {queueStatusLabel(item.status)}
                                                    </span>
                                                </div>
                                                <p>{item.totalUsers} selected users | {item.channel}</p>
                                                <div className="queueCounts">
                                                    <span>Email: {item.sent.email}/{item.requested.email}</span>
                                                    <span>SMS: {item.sent.sms}/{item.requested.sms}</span>
                                                </div>
                                                {item.errors.length > 0 && (
                                                    <p className="queueError">{item.errors[0]}</p>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}
                    </aside>
                )}
            </div>

            {showSendModal && (
                <SendModal
                    groups={groups}
                    users={users}
                    profile={profile}
                    message={selectedMessage}
                    onQueueSend={queueAnnouncementSend}
                    onClose={() => setShowSendModal(false)}
                />
            )}
            {showForm && (
                <FormAnnouncementModal
                    title={title}
                    setTitle={setTitle}
                    input={input}
                    setInput={setInput}
                    onAdd={() => {
                        addMessage();
                        setShowForm(false);
                    }}
                    onClose={() => setShowForm(false)}
                />
            )}
        </div>
    );
}

export default Announcements;
